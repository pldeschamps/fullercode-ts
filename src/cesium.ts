import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { FaceGeoPositions } from './FaceGeoPositions'
import { UnitSphereCartesian } from './UnitSphereCartesian'
import { Subtriangles } from './Subtriangles'
import { loadIcosahedron } from './fuller'
import { initTelstar } from './telstar'
import { fullerData, isMobile, triangles, RADIUS } from './state'
import { findClosestFace, findSubtriangle3D, projectToTriangle, findSubtriangle2D } from './fullercode'
import type { Vec3 } from './Vec3'

function toC3(v: Vec3): Cesium.Cartesian3 {
    return new Cesium.Cartesian3(v.x, v.y, v.z)
}

type IcosahedronFace = { id: string; vertices: number[]; subtrianglesids: string }

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`
}

function interpolateOnSphere(a: Vec3, b: Vec3, t: number): Vec3 {
    const x = a.x * (1 - t) + b.x * t
    const y = a.y * (1 - t) + b.y * t
    const z = a.z * (1 - t) + b.z * t
    const len = Math.sqrt(x * x + y * y + z * z)
    return { x: (x / len) * RADIUS, y: (y / len) * RADIUS, z: (z / len) * RADIUS }
}

function raiseAboveSphere(v: Vec3, offset: number): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    return { x: (v.x / len) * (len + offset), y: (v.y / len) * (len + offset), z: (v.z / len) * (len + offset) }
}

function sampleGreatCircle(a: Vec3, b: Vec3, segments: number): Vec3[] {
    const ax = a.x
    const ay = a.y
    const az = a.z
    const bx = b.x
    const by = b.y
    const bz = b.z
    const naLen = Math.sqrt(ax * ax + ay * ay + az * az)
    const nbLen = Math.sqrt(bx * bx + by * by + bz * bz)
    const na = { x: ax / naLen, y: ay / naLen, z: az / naLen }
    const nb = { x: bx / nbLen, y: by / nbLen, z: bz / nbLen }
    const dot = Math.max(-1, Math.min(1, na.x * nb.x + na.y * nb.y + na.z * nb.z))
    const omega = Math.acos(dot)
    const sinOmega = Math.sin(omega)
    const pts: Vec3[] = []
    for (let i = 0; i <= segments; i++) {
        const t = i / segments
        let factorA: number, factorB: number
        if (sinOmega === 0) {
            factorA = 1 - t
            factorB = t
        } else {
            factorA = Math.sin((1 - t) * omega) / sinOmega
            factorB = Math.sin(t * omega) / sinOmega
        }
        const x = factorA * na.x + factorB * nb.x
        const y = factorA * na.y + factorB * nb.y
        const z = factorA * na.z + factorB * nb.z
        pts.push({ x: x * RADIUS, y: y * RADIUS, z: z * RADIUS })
    }
    return pts
}

// ─── Cesium setup ────────────────────────────────────────────────────────────

Cesium.Ion.defaultAccessToken = ''

const transition3D2D = 11
const sphereEllipsoid = new Cesium.Ellipsoid(RADIUS, RADIUS, RADIUS)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const imageryProviderViewModels: Cesium.ProviderViewModel[] = (Cesium as any).createDefaultImageryProviderViewModels()
let osmProviderViewModel = imageryProviderViewModels.find((p: Cesium.ProviderViewModel) =>
    p.name.replace(/­/g, '').replace(/[^a-z]/gi, '').toLowerCase() === 'openstreetmap'
)
if (!osmProviderViewModel) {
    osmProviderViewModel = new Cesium.ProviderViewModel({
        name: 'OpenStreetMap',
        iconUrl: Cesium.buildModuleUrl('Widgets/Images/ImageryProviders/openStreetMap.png'),
        tooltip: 'OpenStreetMap',
        creationFunction: () => new Cesium.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }),
    })
    imageryProviderViewModels.unshift(osmProviderViewModel)
}

const viewer = new Cesium.Viewer('cesiumContainer', {
    ellipsoid: sphereEllipsoid,
    imageryProviderViewModels,
    selectedImageryProviderViewModel: osmProviderViewModel,
    animation: false,
    timeline: false,
    geocoder: false,
    navigationHelpButton: false,
    selectionIndicator: false,
    infoBox: false,
    skyBox: false,
    skyAtmosphere: false,
})
if (viewer.scene.sun) viewer.scene.sun.show = false
if (viewer.scene.moon) viewer.scene.moon.show = false
viewer.scene.globe.depthTestAgainstTerrain = false

// Telstar controller (set after data load)
let telstarController: { rootEntity: Cesium.Entity; toggle: (show?: boolean) => void } | null = null

// ─── Triangle highlight state ─────────────────────────────────────────────────

const TRIANGLE_DEFAULT_MATERIAL = Cesium.Color.BLUE.withAlpha(0.05)
const TRIANGLE_TRANSPARENT_MATERIAL = Cesium.Color.TRANSPARENT
const TRIANGLE_DEFAULT_OUTLINE_COLOR = Cesium.Color.MAGENTA
const TRIANGLE_SELECTED_MATERIAL = TRIANGLE_DEFAULT_MATERIAL
const TRIANGLE_SELECTED_OUTLINE_COLOR = Cesium.Color.YELLOW

let selectedTriangleEntity: Cesium.Entity | null = null
let triangleDetailsTimeout: ReturnType<typeof setTimeout> | null = null
let triangleDetailsLabel: HTMLElement | null = null

function getTriangleEntityFromSelectedEntity(entity: Cesium.Entity | undefined): Cesium.Entity | null {
    if (!entity || typeof entity.id !== 'string') return null
    if (entity.id.startsWith('triangle ')) return entity
    if (entity.id.startsWith('label ')) {
        return viewer.entities.getById('triangle ' + entity.id.substring('label '.length)) ?? null
    }
    return null
}

function setTriangleHighlighted(entity: Cesium.Entity, highlighted: boolean): void {
    if (!entity.polygon) return
    const compact = window.innerWidth <= 700
    entity.polygon.material = new Cesium.ColorMaterialProperty(
        highlighted ? TRIANGLE_SELECTED_MATERIAL : TRIANGLE_TRANSPARENT_MATERIAL
    )
    entity.polygon.outlineColor = new Cesium.ConstantProperty(
        highlighted ? TRIANGLE_SELECTED_OUTLINE_COLOR : TRIANGLE_DEFAULT_OUTLINE_COLOR
    )
    entity.polygon.outlineWidth = new Cesium.ConstantProperty(
        highlighted ? (compact ? 4 : 8) : (compact ? 2 : 5)
    )
}

function formatVertex(position: Cesium.Cartesian3): string {
    const carto = Cesium.Cartographic.fromCartesian(position, sphereEllipsoid)
    return `${Cesium.Math.toDegrees(carto.latitude).toFixed(6)}, ${Cesium.Math.toDegrees(carto.longitude).toFixed(6)}`
}

function getCentralAngle(a: Cesium.Cartesian3, b: Cesium.Cartesian3): number {
    const na = Cesium.Cartesian3.normalize(a, new Cesium.Cartesian3())
    const nb = Cesium.Cartesian3.normalize(b, new Cesium.Cartesian3())
    const dot = Cesium.Math.clamp(Cesium.Cartesian3.dot(na, nb), -1.0, 1.0)
    return Math.acos(dot)
}

function getSphericalTriangleArea(v0: Cesium.Cartesian3, v1: Cesium.Cartesian3, v2: Cesium.Cartesian3): number {
    const a = getCentralAngle(v1, v2)
    const b = getCentralAngle(v2, v0)
    const c = getCentralAngle(v0, v1)
    const s = (a + b + c) / 2
    const tanProduct =
        Math.tan(s / 2) * Math.tan((s - a) / 2) * Math.tan((s - b) / 2) * Math.tan((s - c) / 2)
    const sphericalExcess = 4 * Math.atan(Math.sqrt(Math.max(0, tanProduct)))
    return sphericalExcess * RADIUS * RADIUS
}

function formatArea(squareMeters: number): string {
    if (!Number.isFinite(squareMeters)) return '-'
    if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(3)} km2`
    return `${squareMeters.toFixed(1)} m2`
}

function showTriangleDetails(entity: Cesium.Entity): void {
    if (!triangleDetailsLabel) return
    const triangleId = entity.id.substring('triangle '.length)
    const face = triangles.find(t => t.faceId === triangleId)
    if (!face) return
    const [c0, c1, c2] = face.vertices.map(toC3)
    const vertices = [c0, c1, c2].map(formatVertex)
    const area = getSphericalTriangleArea(c0, c1, c2)
    triangleDetailsLabel.innerHTML = `
        <div>code: ${triangleId}</div>
        <div>A: ${vertices[0] ?? '-'}</div>
        <div>B: ${vertices[1] ?? '-'}</div>
        <div>C: ${vertices[2] ?? '-'}</div>
        <div>surface: ${formatArea(area)}</div>
    `
    triangleDetailsLabel.classList.add('visible')
    if (triangleDetailsTimeout) clearTimeout(triangleDetailsTimeout)
    triangleDetailsTimeout = setTimeout(() => triangleDetailsLabel?.classList.remove('visible'), 2000)
}

function selectTriangleEntity(triangleEntity: Cesium.Entity): void {
    if (selectedTriangleEntity && selectedTriangleEntity !== triangleEntity) {
        setTriangleHighlighted(selectedTriangleEntity, false)
    }
    selectedTriangleEntity = triangleEntity
    setTriangleHighlighted(selectedTriangleEntity, true)
    showTriangleDetails(selectedTriangleEntity)
}

viewer.selectedEntityChanged.addEventListener((entity: Cesium.Entity | undefined) => {
    if (selectedTriangleEntity) {
        setTriangleHighlighted(selectedTriangleEntity, false)
        selectedTriangleEntity = null
    }
    const triangleEntity = getTriangleEntityFromSelectedEntity(entity)
    if (triangleEntity) selectTriangleEntity(triangleEntity)
})

viewer.canvas.addEventListener('click', (event: MouseEvent) => {
    const rect = viewer.canvas.getBoundingClientRect()
    const picked = viewer.scene.pick(
        new Cesium.Cartesian2(event.clientX - rect.left, event.clientY - rect.top)
    ) as { id?: Cesium.Entity } | undefined
    const triangleEntity = getTriangleEntityFromSelectedEntity(picked?.id)
    if (triangleEntity) selectTriangleEntity(triangleEntity)
})

// ─── UI widgets ───────────────────────────────────────────────────────────────

const cameraLabel = document.createElement('div')
cameraLabel.id = 'cameraWidget'
cameraLabel.textContent = 'Lat: - Lon: - Alt: -'
viewer.container.appendChild(cameraLabel)

const fullerCodeLabel = document.createElement('div')
fullerCodeLabel.id = 'fullerCodeWidget'
fullerCodeLabel.textContent = 'fullercode: '
viewer.container.appendChild(fullerCodeLabel)

const fullerCodeCopyBtn = document.createElement('button')
fullerCodeCopyBtn.id = 'fullerCodeCopy'
fullerCodeCopyBtn.type = 'button'
fullerCodeCopyBtn.textContent = 'Copy'
fullerCodeCopyBtn.className = 'fullerCodeCopy'
fullerCodeCopyBtn.setAttribute('aria-label', 'Copy fullercode link')
viewer.container.appendChild(fullerCodeCopyBtn)

const fullerCodeShareBtn = document.createElement('button')
fullerCodeShareBtn.id = 'fullerCodeShare'
fullerCodeShareBtn.type = 'button'
fullerCodeShareBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.23c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.44 9.31 6.77 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.77 0 1.44-.3 1.96-.77l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/></svg>'
fullerCodeShareBtn.className = 'fullerCodeShare'
fullerCodeShareBtn.setAttribute('aria-label', 'Share location')
viewer.container.appendChild(fullerCodeShareBtn)

const fullerCodeCenterBtn = document.createElement('button')
fullerCodeCenterBtn.id = 'fullerCodeCenter'
fullerCodeCenterBtn.type = 'button'
fullerCodeCenterBtn.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="4" opacity="0.6"/></svg>'
fullerCodeCenterBtn.className = 'fullerCodeCenter'
fullerCodeCenterBtn.setAttribute('aria-label', 'Center on my location')
viewer.container.appendChild(fullerCodeCenterBtn)

// Telstar toggle button (pink outline with Telstar icon)
const telstarToggleBtn = document.createElement('button')
telstarToggleBtn.id = 'telstarToggle'
telstarToggleBtn.type = 'button'
telstarToggleBtn.className = 'telstarToggle'
telstarToggleBtn.setAttribute('aria-label', 'Toggle Telstar ball')
telstarToggleBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 32 32" id="Telstar" height="22" width="22">
    <desc>
        Telstar
    </desc>
    <!-- white background for the ball -->
    <circle cx="16" cy="16" r="16" fill="#ffffff" />
  <g>
    <path fill="#000000" d="M30.967 15.996c0.0105 -0.3565 0.1045 -5.452 -2.911 -8.769 -0.134 -0.2965 -0.7695 -1.4915 -2.8205 -2.952a20.9795 20.9795 0 0 0 -2.8875 -1.8815l-0.004 -0.002C22.216 2.323 19.715 1 16.6795 1c-0.2305 0 -0.4585 0.0135 -0.684 0.029V1.025c-2.3145 -0.0505 -4.6135 0.545 -5.999 1.1705 -1.229 0.555 -2.5935 1.4855 -2.692 1.5575C5.6025 4.705 2.375 8.5255 2.1195 10.55c-1.0315 1.3185 -1.8935 7.241 0.002 10.8485 1.329 5.0135 6.332 7.5225 6.73 7.715 0.242 0.1545 2.9685 1.84 6.318 1.84 0.1405 0 0.99 0.047 1.293 0.047 3.6205 0 8.9855 -2.552 10.1085 -4.551 3.0855 -2.257 4.685 -8.0735 4.396 -10.4535ZM8.879 23.5275c-1.4345 -2.3205 -2.252 -5.3525 -2.427 -6.049 0.454 -0.6805 2.6935 -3.9825 3.9695 -4.976 0.7225 0.133 3.7395 0.687 6.585 1.202 0.3575 0.9265 1.926 5.0145 2.375 6.5925 -0.495 0.587 -2.4395 2.851 -4.354 4.624 -2.0325 0.0095 -5.4895 -1.163 -6.1485 -1.3935ZM26.912 7.29c-0.006 0.225 -0.0595 1.025 -0.4425 1.9435 -0.7605 -0.3885 -2.672 -1.2205 -5.292 -1.361 -0.3965 -0.5855 -1.8885 -2.627 -4.245 -4.043 0.3225 -0.631 0.7715 -1.4005 1.034 -1.635 0.085 -0.024 0.217 -0.046 0.418 -0.046 1.2635 0 3.4465 0.8275 3.6365 0.901 0.2015 0.1065 4.1255 2.2195 4.891 4.2405ZM5.8865 17.006c-1.7115 -0.292 -2.729 -0.824 -3.033 -1.004 -0.6365 -2.3085 -0.124 -4.8035 -0.045 -5.161 0.628 -1.123 2.416 -3.9855 3.5955 -4.529 1.2225 -0.2495 2.747 0.0605 3.368 0.212 -0.0585 0.8075 -0.171 3.0635 0.163 5.431 -1.353 1.089 -3.4945 4.2235 -4.0485 5.051ZM15.8425 1.765c0.384 0.0285 0.9475 0.1125 1.3335 0.227 -0.385 0.512 -0.7795 1.271 -0.966 1.646 -0.785 0.1285 -3.7665 0.6985 -6.1055 2.215 -0.4715 -0.125 -1.8955 -0.4585 -3.244 -0.3435 0.334 -0.6465 0.833 -1.1245 0.8865 -1.1735 0.1855 -0.133 3.7565 -2.6315 8.0955 -2.5775v0.0065Zm9.548 19.0465c-0.585 -0.024 -2.839 -0.1525 -5.3105 -0.733 -0.4735 -1.651 -2.037 -5.722 -2.3945 -6.648a278.293 278.293 0 0 1 3.464 -4.827c2.844 0.156 4.841 1.1935 5.2275 1.41 1.6475 2.6495 2.009 5.3555 2.0585 5.8075 -0.875 2.723 -2.6055 4.5565 -3.045 4.9905ZM1.8275 14.2595c0.042 0.633 0.1435 1.2995 0.327 1.9585a5.869 5.869 0 0 0 -0.341 1.3255 16.5195 16.5195 0 0 1 0.014 -3.284Zm4.822 11.6795c0.754 -0.7265 1.6835 -1.4335 2.044 -1.7005 0.815 0.287 4.162 1.4185 6.2955 1.4185 0.3635 0.4875 1.552 2.014 3.009 3.181 -0.907 0.8875 -2.217 1.3065 -2.4485 1.376 -4.0635 0.109 -8.021 -2.175 -8.9 -4.275Zm10.7315 4.269c0.461 -0.2685 0.9415 -0.622 1.339 -1.0695 0.6485 -0.0895 3.4315 -0.5685 5.9465 -2.416 0.166 0.018 0.4395 0.04 0.745 0.0315 -1.509 1.4785 -5.191 3.13 -8.0305 3.454Zm7.712 -4.188c0.9035 -2.354 0.865 -4.129 0.8205 -4.696 0.496 -0.486 2.198 -2.2995 3.1425 -5.0565 0.509 0.085 0.84 0.2145 0.997 0.287 0.0545 0.2 0.1455 0.662 0.094 1.3625 -0.385 2.5215 -1.714 6.3 -4.042 7.9705 -0.234 0.1195 -0.646 0.1455 -1.012 0.1325Z" stroke-width="0.5"></path>
    </g>
</svg>`
telstarToggleBtn.style.border = '1px solid #ff69b4'
telstarToggleBtn.style.borderRadius = '6px'
telstarToggleBtn.style.width = '34px'
telstarToggleBtn.style.height = '34px'
telstarToggleBtn.style.padding = '4px'
telstarToggleBtn.style.background = 'transparent'
telstarToggleBtn.style.cursor = 'pointer'
telstarToggleBtn.style.position = 'absolute'
telstarToggleBtn.style.zIndex = '1000'
viewer.container.appendChild(telstarToggleBtn)

const shareMenu = document.createElement('div')
shareMenu.id = 'shareMenu'
shareMenu.className = 'shareMenu'
shareMenu.innerHTML = `
  <button class="shareOption" data-app="googlemaps" aria-label="Open in Google Maps">
    <img class="app-icon" src="https://www.google.com/s2/favicons?domain=www.google.com/maps&sz=64" width="20" height="20" alt="Google Maps">
    <span>Google Maps</span>
  </button>
  <button class="shareOption" data-app="applemaps" aria-label="Open in Apple Maps">
    <img class="app-icon" src="https://www.google.com/s2/favicons?domain=maps.apple.com/&sz=64" width="20" height="20" alt="Apple Maps">
    <span>Apple Maps</span>
  </button>
  <button class="shareOption" data-app="waze" aria-label="Open in Waze">
    <img class="app-icon" src="https://www.waze.com/favicon.ico" width="20" height="20" alt="Waze">
    <span>Waze</span>
  </button>
  <button class="shareOption" data-app="herewego" aria-label="Open in Here We Go">
    <img class="app-icon" src="https://www.google.com/s2/favicons?domain=wego.here.com&sz=64" width="20" height="20" alt="Here We Go">
    <span>Here WeGo</span>
  </button>
`
viewer.container.appendChild(shareMenu)

function positionHeaderButtons(): void {
    try {
        const rect = fullerCodeLabel.getBoundingClientRect()
        const containerRect = (viewer.container as HTMLElement).getBoundingClientRect()
        const copyLeft = rect.right - containerRect.left + 8
        fullerCodeCopyBtn.style.left = copyLeft + 'px'
        fullerCodeCopyBtn.style.top = rect.top - containerRect.top + 'px'
        const copyRect = fullerCodeCopyBtn.getBoundingClientRect()
        const shareLeft = copyLeft + (copyRect.width > 0 ? copyRect.width + 8 : 78)
        fullerCodeShareBtn.style.left = shareLeft + 'px'
        fullerCodeShareBtn.style.top = rect.top - containerRect.top + 'px'
        const shareRect = fullerCodeShareBtn.getBoundingClientRect()
        fullerCodeCenterBtn.style.left = shareRect.left - containerRect.left + shareRect.width + 8 + 'px'
        fullerCodeCenterBtn.style.top = rect.top - containerRect.top + 'px'
        try {
            const centerRect = fullerCodeCenterBtn.getBoundingClientRect()
            telstarToggleBtn.style.left = centerRect.left - containerRect.left + centerRect.width + 8 + 'px'
            telstarToggleBtn.style.top = rect.top - containerRect.top + 'px'
        } catch {
            telstarToggleBtn.style.left = '380px'
            telstarToggleBtn.style.top = '8px'
        }
        shareMenu.style.left = shareRect.left - containerRect.left + 'px'
        shareMenu.style.top = shareRect.bottom - containerRect.top + 4 + 'px'
    } catch {
        fullerCodeCopyBtn.style.left = '220px'
        fullerCodeShareBtn.style.left = '300px'
        shareMenu.style.left = '300px'
        shareMenu.style.top = '40px'
        telstarToggleBtn.style.left = '380px'
        telstarToggleBtn.style.top = '8px'
    }
}

fullerCodeShareBtn.addEventListener('click', () => shareMenu.classList.toggle('visible'))

fullerCodeCenterBtn.addEventListener('click', () => {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude: lat, longitude: lon, altitude } = position.coords
                const height = altitude != null ? Math.max(altitude + 20, 50) : 1000
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height, sphereEllipsoid),
                    orientation: { heading: 0.0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0.0 },
                })
            },
            error => {
                console.warn('Geolocation unavailable', error)
                viewer.camera.flyTo({ destination: viewer.camera.position })
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
        )
    } else {
        viewer.camera.flyTo({ destination: viewer.camera.position })
    }
})

document.addEventListener('click', (e: MouseEvent) => {
    if (!fullerCodeShareBtn.contains(e.target as Node) && !shareMenu.contains(e.target as Node)) {
        shareMenu.classList.remove('visible')
    }
})

document.querySelectorAll<HTMLButtonElement>('.shareOption').forEach(btn => {
    btn.addEventListener('click', async () => {
        const app = btn.dataset.app
        const carto = viewer.camera.positionCartographic
        const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6)
        const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6)
        const labelText = (fullerCodeLabel.textContent ?? '').trim()
        const code = (labelText.match(/([A-Z0-9]+)$/i)?.[1] ?? '').toUpperCase()
        const altitude = carto.height
        const span = altitude * 0.0000035
        const herewegozoom = 26.75 - Math.log2(altitude)
        let url = ''
        switch (app) {
            case 'googlemaps':
                url = isMobile ? `comgooglemaps://?q=${lat},${lon}` : `https://maps.google.com/maps?q=${lat},${lon}`
                break
            case 'applemaps':
                url = `https://maps.apple.com/frame?center=${lat},${lon}&span=${span},${span}`
                break
            case 'waze':
                url = isMobile ? `waze://?q=${lat},${lon}` : `https://waze.com/ul?q=${lat},${lon}`
                break
            case 'herewego':
                url = `https://wego.here.com/?map=${lat},${lon},${herewegozoom}`
                break
        }
        if (isMobile && (app === 'googlemaps' || app === 'waze')) {
            window.location.href = url
            setTimeout(() => {
                window.location.href = app === 'googlemaps'
                    ? `https://maps.google.com/maps?q=${lat},${lon}`
                    : `https://waze.com/ul?q=${lat},${lon}`
            }, 500)
        } else {
            window.open(url, '_blank')
        }
        shareMenu.classList.remove('visible')
    })
})

positionHeaderButtons()
window.addEventListener('resize', positionHeaderButtons)

async function copyFullercodeLink(): Promise<void> {
    const labelText = (fullerCodeLabel.textContent ?? '').trim()
    let code = (labelText.match(/([A-Z0-9]+)$/i)?.[1] ?? '').toUpperCase()
    if (!code) code = fullerCodeInput.value.trim().toUpperCase()
    const url = 'https://www.fullercode.org/index.html' + (code ? '#' + code : '')
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url)
        } else {
            const ta = document.createElement('textarea')
            ta.value = url
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
        }
        const old = fullerCodeCopyBtn.textContent ?? 'Copy'
        fullerCodeCopyBtn.textContent = 'Copied!'
        setTimeout(() => { fullerCodeCopyBtn.textContent = old }, 1500)
    } catch (err) {
        console.error('Copy failed', err)
        fullerCodeCopyBtn.textContent = 'Failed'
        setTimeout(() => { fullerCodeCopyBtn.textContent = 'Copy' }, 1500)
    }
}
fullerCodeCopyBtn.addEventListener('click', copyFullercodeLink)

telstarToggleBtn.addEventListener('click', () => {
    try {
        if (!telstarController) return
        const currently = !!telstarController.rootEntity.show
        telstarController.toggle(!currently)
        telstarToggleBtn.classList.toggle('active', !currently)
    } catch (e) {
        console.error('Telstar toggle failed', e)
    }
})

// ─── Fuller code input ────────────────────────────────────────────────────────

const fullerCodeInput = document.createElement('input')
fullerCodeInput.id = 'fullerCodeInput'
fullerCodeInput.type = 'text'
fullerCodeInput.placeholder = 'Enter fullercode...'
viewer.container.appendChild(fullerCodeInput)

triangleDetailsLabel = document.createElement('div')
triangleDetailsLabel.id = 'triangleDetails'
viewer.container.appendChild(triangleDetailsLabel)

let cameraHeight = 100_000

const MAX_FULLERCODE_LEN = 12
const ALLOWED_FIRST = 'CM3FA2H5PX9V8TR7NSJK'
const ALLOWED_REST = 'CM3FA2H5PX9V8TR7'
const LevelHeights = isMobile
    ? [5_000_000, 1_800_000, 600_000, 140_000, 60_000, 6_000, 1_200, 400, 120, 16, 4]
    : [6_500_000, 2_600_000, 1_000_000, 200_000, 100_000, 10_000, 1_800, 700, 170, 50, 10]

fullerCodeInput.maxLength = MAX_FULLERCODE_LEN
fullerCodeInput.addEventListener('input', function () {
    const raw = (this.value ?? '').toUpperCase()
    let filtered = ''
    for (let i = 0; i < raw.length && filtered.length < MAX_FULLERCODE_LEN; i++) {
        const ch = raw[i]
        if (i === 0 ? ALLOWED_FIRST.includes(ch) : ALLOWED_REST.includes(ch)) filtered += ch
    }
    if (this.value !== filtered) this.value = filtered
    if (filtered.length > 1) {
        const idx = Math.min(filtered.length - 1, LevelHeights.length - 1)
        const prevIdx = Math.max(filtered.length - 2, 0)
        cameraHeight = (LevelHeights[idx] + LevelHeights[prevIdx]) / 2
    } else {
        cameraHeight = 7_000_000
    }
})

fullerCodeInput.addEventListener('keypress', function (e: KeyboardEvent) {
    if (e.key === 'Enter') flyToCode(this.value.trim())
})

function flyToCode(code: string): void {
    if (!code) { console.log('invalid code'); return }
    if (!fullerData.facesGeoPositions) { console.log('Cannot fly: data not ready'); return }

    let targetTriangle = triangles.find(t => t.faceId === code)
    if (!targetTriangle) {
        try {
            createLevels(code.length)
            for (let i = 1; i <= code.length; i++) {
                const partial = code.substring(0, i)
                const sub = triangles.find(t => t.faceId === partial)
                if (sub) addSubtriangles(sub, i - 1)
                else console.log('Could not find parent triangle for:', partial)
            }
            targetTriangle = triangles.find(t => t.faceId === code)
        } catch (e) {
            console.error('Error creating subtriangles:', e)
        }
    }

    if (targetTriangle) {
        try {
            const carto = sphereEllipsoid.cartesianToCartographic(toC3(targetTriangle.center))
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, cameraHeight, sphereEllipsoid),
                orientation: { heading: 0.0, pitch: -Cesium.Math.PI_OVER_TWO, roll: 0.0 },
            })
        } catch (e) {
            console.error('Error flying to triangle:', e)
        }
    } else {
        console.log('Fullercode not found:', code)
    }
}

// ─── URL parsing ──────────────────────────────────────────────────────────────

function parseFullercodeFromUrl(): string | null {
    const MAX = MAX_FULLERCODE_LEN
    let code: string | null = null

    if (window.location.hash && window.location.hash.length > 1) {
        let h = window.location.hash.substring(1)
        if (h.startsWith('@')) h = h.substring(1)
        if (h.length > 0) code = h.split(/[/?&#]/)[0]
    }

    if (!code && window.location.search && window.location.search.length > 1) {
        const raw = window.location.search.substring(1)
        if (!raw.includes('=')) {
            code = raw.split('&')[0]
        } else {
            for (const p of raw.split('&')) {
                const [, val] = p.split('=')
                if (val) { code = val.toUpperCase().replace(/[^A-Z0-9]/g, ''); break }
            }
        }
    }

    if (!code) {
        const href = window.location.href
        const atIndex = href.indexOf('/@')
        const at2 = href.indexOf('@')
        let idx = atIndex !== -1 ? atIndex + 2 : at2 !== -1 ? at2 + 1 : -1
        if (idx !== -1) {
            let substr = href.substring(idx)
            const stop = substr.search(/[/?&#]/)
            if (stop !== -1) substr = substr.substring(0, stop)
            code = substr
        }
    }

    if (!code) return null
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, MAX)
}

// ─── Imagery layer tweaks ─────────────────────────────────────────────────────

const layer = viewer.imageryLayers.get(0)
layer.show = true
layer.alpha = 1.0
layer.brightness = 1.2
layer.minificationFilter = Cesium.TextureMinificationFilter.LINEAR
layer.magnificationFilter = Cesium.TextureMagnificationFilter.LINEAR

viewer.scene.screenSpaceCameraController.enableTilt = false

// ─── Entities and levels ──────────────────────────────────────────────────────

viewer.entities.add({
    id: 'camera',
    position: Cesium.Cartesian3.fromDegrees(0, 90, 0, sphereEllipsoid),
    point: { pixelSize: 5, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 1 },
    label: { text: 'your position', font: '24px sans-serif', pixelOffset: new Cesium.Cartesian2(0, -12) },
})

const entitiesLevels: Cesium.Entity[] = []
entitiesLevels.push(viewer.entities.add(new Cesium.Entity()))
entitiesLevels.push(viewer.entities.add(new Cesium.Entity()))

const addedSub: string[] = []

// ─── Initialisation on data load ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const initCode = parseFullercodeFromUrl()
    const interval = setInterval(() => {
        if (fullerData.facesPositions) {
            console.log('Data loaded, initializing...')
            addPolygons(fullerData.facesGeoPositions!, entitiesLevels[0])
            if (initCode) {
                fullerCodeInput.value = initCode
                fullerCodeInput.dispatchEvent(new Event('input', { bubbles: true }))
                setTimeout(() => flyToCode(initCode), 1000)
            }
            clearInterval(interval)
        }
    }, 100)
})

loadIcosahedron().then(({ vertices, faces }) => {
    try {
        telstarController = initTelstar(viewer, vertices, faces, RADIUS, { fillAlpha: 0.2, segments: 12, offset: 30 })
        // ensure button reflects initial state
        telstarToggleBtn.classList.toggle('active', !!telstarController?.rootEntity.show)
    } catch (e) {
        console.error('Failed to initialize Telstar:', e)
    }
}).catch(err => console.error('Failed to load icosahedron:', err))

// ─── Camera events ────────────────────────────────────────────────────────────

viewer.camera.changed.addEventListener(findEnclosingTriangle)
viewer.camera.changed.addEventListener(updateCameraLabel)
updateCameraLabel()

// ─── Polygon drawing ──────────────────────────────────────────────────────────

function addPolygons(facesGeoPositions: FaceGeoPositions[], parentEntity: Cesium.Entity): void {
    if (!facesGeoPositions) return
    facesGeoPositions.forEach(faceObj => {
        addPolygon(faceObj.vertices, faceObj.faceId, parentEntity, faceObj.center)
        triangles.push(faceObj)
    })
}

function geodesicEdge(v0: Vec3, v1: Vec3, n: number): Cesium.Cartesian3[] {
    const pts: Cesium.Cartesian3[] = [toC3(v0)]
    for (let i = 1; i <= n; i++) {
        const t = i / (n + 1)
        const x = v0.x + t * (v1.x - v0.x)
        const y = v0.y + t * (v1.y - v0.y)
        const z = v0.z + t * (v1.z - v0.z)
        const len = Math.sqrt(x * x + y * y + z * z)
        pts.push(new Cesium.Cartesian3((x * RADIUS) / len, (y * RADIUS) / len, (z * RADIUS) / len))
    }
    return pts
}

function addPolygon(
    positions: Vec3[],
    triangleId: string,
    parentEntity: Cesium.Entity,
    center: Vec3
): void {
    const compact = window.innerWidth <= 700
    const n = triangleId.length <= 4 ? 16 : 4
    const [v0, v1, v2] = positions
    const hierarchy = new Cesium.PolygonHierarchy([
        ...geodesicEdge(v0, v1, n),
        ...geodesicEdge(v1, v2, n),
        ...geodesicEdge(v2, v0, n),
    ])

    viewer.entities.add({
        id: 'triangle ' + triangleId,
        parent: parentEntity,
        polygon: {
            hierarchy,
            perPositionHeight: true,
            material: new Cesium.ColorMaterialProperty(TRIANGLE_TRANSPARENT_MATERIAL),
            outline: true,
            outlineWidth: compact ? 2 : 5,
            outlineColor: new Cesium.ConstantProperty(TRIANGLE_DEFAULT_OUTLINE_COLOR),
        },
    })
    const labelFont = (32 - triangleId.length).toString() + 'px Consolas'
    viewer.entities.add({
        id: 'label ' + triangleId,
        parent: parentEntity,
        position: toC3(center),
        label: {
            text: triangleId,
            font: labelFont,
            fillColor: Cesium.Color.MAGENTA.withAlpha(0.8),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    })
}

// ─── Camera label update ──────────────────────────────────────────────────────

function updateCameraLabel(): void {
    const carto = viewer.camera.positionCartographic
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6)
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6)
    cameraLabel.textContent = `Lat: ${lat} Lon: ${lon} Alt: ${carto.height.toFixed(0)}`
}

// ─── Enclosing triangle finder ────────────────────────────────────────────────

function findEnclosingTriangle(): void {
    const facesGeoPositions = fullerData.facesGeoPositions
    if (!facesGeoPositions) return

    const cameraCartographic = viewer.camera.positionCartographic
    const cameraUnitSphere = new UnitSphereCartesian(cameraCartographic)
    const cameraPosSurface: Vec3 = {
        x: cameraUnitSphere.x * RADIUS,
        y: cameraUnitSphere.y * RADIUS,
        z: cameraUnitSphere.z * RADIUS,
    }

    const cameraEntity = viewer.entities.getById('camera')
    if (cameraEntity) {
        cameraEntity.position = new Cesium.ConstantPositionProperty(toC3(cameraPosSurface))
        if (cameraEntity.point) cameraEntity.point.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
        if (cameraEntity.label) cameraEntity.label.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
    }

    const levelIndex = getLevelIndex(cameraCartographic.height)
    createLevels(levelIndex)
    for (let i = 0; i < entitiesLevels.length; i++) {
        entitiesLevels[i].show = i === levelIndex
    }

    const closest = findClosestFace(facesGeoPositions, cameraUnitSphere)
    if (!closest) return
    let currentFace: FaceGeoPositions = closest

    let g2d_Xc = 0, g2d_Yc = 0

    for (let i = 0; i < levelIndex; i++) {
        addSubtriangles(currentFace, i)

        let enclosingIdx: number
        if (i < transition3D2D) {
            enclosingIdx = findSubtriangle3D(currentFace, cameraUnitSphere)
        } else {
            if (i === transition3D2D) {
                const coords = projectToTriangle(currentFace, cameraPosSurface)
                g2d_Xc = coords.Xc
                g2d_Yc = coords.Yc
            }
            const result = findSubtriangle2D(g2d_Xc, g2d_Yc)
            enclosingIdx = result.index
            g2d_Xc = result.Xc
            g2d_Yc = result.Yc
        }

        const nextId: string = currentFace.faceId + currentFace.ids[enclosingIdx]
        const next: FaceGeoPositions | undefined = triangles.find(t => t.faceId === nextId)
        if (!next) { console.log('Could not find face with id:', nextId); return }
        currentFace = next

        fullerCodeLabel.textContent = `fullercode: ${currentFace.faceId}`
        positionHeaderButtons()
    }
}

// ─── Subtriangle management ───────────────────────────────────────────────────

function addSubtriangles(closestFace: FaceGeoPositions, i: number): void {
    if (!closestFace) return
    if (!addedSub.includes(closestFace.faceId)) {
        addedSub.push(closestFace.faceId)
        const st = new Subtriangles(closestFace)
        addPolygons(st.subFaces, entitiesLevels[i + 1])
    }
}

function createLevels(levelIndex: number): void {
    for (let i = entitiesLevels.length; i <= levelIndex; i++) {
        entitiesLevels.push(viewer.entities.add(new Cesium.Entity()))
    }
}

function getLevelIndex(height: number): number {
    for (let i = 0; i < LevelHeights.length; i++) {
        if (height >= LevelHeights[i]) return i
    }
    return LevelHeights.length
}
