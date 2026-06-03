import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { CartesianCoord } from './CartesianCoord'
import { FaceGeoPositions } from './FaceGeoPositions'
import { UnitSphereCartesian } from './UnitSphereCartesian'
import { cross_product, dot_product } from './vectorOps'
import { Subtriangles } from './Subtriangles'
import { loadIcosahedron } from './fuller'
import { fullerData, isMobile, setViewer, triangles, RADIUS } from './state'

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
setViewer(viewer)
if (viewer.scene.sun) viewer.scene.sun.show = false
if (viewer.scene.moon) viewer.scene.moon.show = false

// ─── Triangle highlight state ─────────────────────────────────────────────────

const TRIANGLE_DEFAULT_MATERIAL = Cesium.Color.BLUE.withAlpha(0.05)
const TRIANGLE_DEFAULT_OUTLINE_COLOR = Cesium.Color.MAGENTA
const TRIANGLE_SELECTED_MATERIAL = Cesium.Color.YELLOW.withAlpha(0.35)
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
        highlighted ? TRIANGLE_SELECTED_MATERIAL : TRIANGLE_DEFAULT_MATERIAL
    )
    entity.polygon.outlineColor = new Cesium.ConstantProperty(
        highlighted ? TRIANGLE_SELECTED_OUTLINE_COLOR : TRIANGLE_DEFAULT_OUTLINE_COLOR
    )
    entity.polygon.outlineWidth = new Cesium.ConstantProperty(
        highlighted ? (compact ? 4 : 8) : (compact ? 2 : 5)
    )
}

function getTrianglePositions(entity: Cesium.Entity): Cesium.Cartesian3[] {
    const hierarchy = entity.polygon?.hierarchy
    if (!hierarchy) return []
    const value = typeof hierarchy.getValue === 'function'
        ? hierarchy.getValue(viewer.clock.currentTime)
        : (hierarchy as unknown as Cesium.PolygonHierarchy)
    return (value as Cesium.PolygonHierarchy)?.positions ?? []
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

function getSphericalTriangleArea(positions: Cesium.Cartesian3[]): number {
    if (!positions || positions.length < 3) return 0
    const a = getCentralAngle(positions[1], positions[2])
    const b = getCentralAngle(positions[2], positions[0])
    const c = getCentralAngle(positions[0], positions[1])
    const s = (a + b + c) / 2
    const tanProduct =
        Math.tan(s / 2) * Math.tan((s - a) / 2) * Math.tan((s - b) / 2) * Math.tan((s - c) / 2)
    const sphericalExcess = 4 * Math.atan(Math.sqrt(Math.max(0, tanProduct)))
    return sphericalExcess * RADIUS * RADIUS
}

function formatArea(squareMeters: number): string {
    if (!Number.isFinite(squareMeters)) return '-'
    if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(3)} km2`
    return `${squareMeters.toFixed(0)} m2`
}

function showTriangleDetails(entity: Cesium.Entity): void {
    if (!triangleDetailsLabel) return
    const triangleId = entity.id.substring('triangle '.length)
    const positions = getTrianglePositions(entity)
    const vertices = positions.slice(0, 3).map(formatVertex)
    const area = getSphericalTriangleArea(positions)
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
        shareMenu.style.left = shareRect.left - containerRect.left + 'px'
        shareMenu.style.top = shareRect.bottom - containerRect.top + 4 + 'px'
    } catch {
        fullerCodeCopyBtn.style.left = '220px'
        fullerCodeShareBtn.style.left = '300px'
        shareMenu.style.left = '300px'
        shareMenu.style.top = '40px'
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
    if (!fullerData.viewer) { console.log('Cannot fly: data not ready'); return }

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
            const carto = sphereEllipsoid.cartesianToCartographic(targetTriangle.center)
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

loadIcosahedron().catch(err => console.error('Failed to load icosahedron:', err))

// ─── Camera events ────────────────────────────────────────────────────────────

viewer.camera.changed.addEventListener(findEnclosingTriangle)
viewer.camera.changed.addEventListener(updateCameraLabel)
updateCameraLabel()

// ─── Polygon drawing ──────────────────────────────────────────────────────────

function addPolygons(facesGeoPositions: FaceGeoPositions[], parentEntity: Cesium.Entity): void {
    if (!facesGeoPositions || !fullerData.viewer) return
    facesGeoPositions.forEach(faceObj => {
        addPolygon(faceObj.vertices, faceObj.faceId, parentEntity, faceObj.center)
        triangles.push(faceObj)
    })
}

function geodesicEdge(v0: Cesium.Cartesian3, v1: Cesium.Cartesian3, n: number): Cesium.Cartesian3[] {
    const pts: Cesium.Cartesian3[] = [v0]
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
    positions: Cesium.Cartesian3[],
    triangleId: string,
    parentEntity: Cesium.Entity,
    center: Cesium.Cartesian3
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
            material: new Cesium.ColorMaterialProperty(TRIANGLE_DEFAULT_MATERIAL),
            outline: true,
            outlineWidth: compact ? 2 : 5,
            outlineColor: new Cesium.ConstantProperty(TRIANGLE_DEFAULT_OUTLINE_COLOR),
        },
    })
    const labelFont = (32 - triangleId.length).toString() + 'px Consolas'
    viewer.entities.add({
        id: 'label ' + triangleId,
        parent: parentEntity,
        position: center,
        label: {
            text: triangleId,
            font: labelFont,
            fillColor: Cesium.Color.MAGENTA.withAlpha(0.9),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
    })
}

// ─── Camera label update ──────────────────────────────────────────────────────

function updateCameraLabel(): void {
    if (!fullerData.viewer) return
    const carto = viewer.camera.positionCartographic
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6)
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6)
    cameraLabel.textContent = `Lat: ${lat} Lon: ${lon} Alt: ${carto.height.toFixed(0)}`
}

// ─── Enclosing triangle finder ────────────────────────────────────────────────

function findEnclosingTriangle(): void {
    const facesGeoPositions = fullerData.facesGeoPositions
    if (!fullerData.viewer || !facesGeoPositions) return

    const cameraCartographic = viewer.camera.positionCartographic
    const cameraUnitSphere = new UnitSphereCartesian(cameraCartographic)
    const cameraNormalized = new CartesianCoord(cameraUnitSphere)
    const cameraPosSurface = Cesium.Cartesian3.multiplyByScalar(
        new Cesium.Cartesian3(cameraUnitSphere.x, cameraUnitSphere.y, cameraUnitSphere.z),
        RADIUS,
        new Cesium.Cartesian3()
    )

    const cameraEntity = viewer.entities.getById('camera')
    if (cameraEntity) {
        cameraEntity.position = new Cesium.ConstantPositionProperty(cameraPosSurface)
        if (cameraEntity.point) cameraEntity.point.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
        if (cameraEntity.label) cameraEntity.label.heightReference = new Cesium.ConstantProperty(Cesium.HeightReference.NONE)
    }

    const levelIndex = getLevelIndex(cameraCartographic.height)
    createLevels(levelIndex)

    for (let i = 0; i < entitiesLevels.length; i++) {
        entitiesLevels[i].show = i === levelIndex
    }

    let minDist = Number.POSITIVE_INFINITY
    let _closest: FaceGeoPositions | undefined
    for (const faceObj of facesGeoPositions) {
        const dist = Cesium.Cartesian3.distance(cameraUnitSphere as unknown as Cesium.Cartesian3, faceObj.center)
        if (dist < minDist) { minDist = dist; _closest = faceObj }
    }
    if (!_closest) return
    let currentFace: FaceGeoPositions = _closest

    for (let i = 0; i < levelIndex; i++) {
        addSubtriangles(currentFace, i)

        let enclosingTriangleId: number

        if (i < transition3D2D) {
            const p_ab  = new CartesianCoord(currentFace.v[3])
            const p_bc  = new CartesianCoord(currentFace.v[4])
            const p_ac  = new CartesianCoord(currentFace.v[5])
            const p_a_ab  = new CartesianCoord(currentFace.v[6])
            const p_ab_b  = new CartesianCoord(currentFace.v[11])
            const p_b_bc  = new CartesianCoord(currentFace.v[9])
            const p_bc_c  = new CartesianCoord(currentFace.v[14])
            const p_c_ac  = new CartesianCoord(currentFace.v[12])
            const p_ac_a  = new CartesianCoord(currentFace.v[8])
            const p_ab_bc = new CartesianCoord(currentFace.v[10])
            const p_bc_ac = new CartesianCoord(currentFace.v[13])
            const p_ac_ab = new CartesianCoord(currentFace.v[7])

            let cp = cross_product(p_ab, p_bc)
            let dp = dot_product(cp, cameraNormalized)

            if (dp > 0) {
                cp = cross_product(p_ab_bc, p_ab_b); dp = dot_product(cp, cameraNormalized)
                if (dp > 0) { enclosingTriangleId = 5 }
                else {
                    cp = cross_product(p_ab_b, p_b_bc); dp = dot_product(cp, cameraNormalized)
                    if (dp > 0) { enclosingTriangleId = 6 }
                    else {
                        cp = cross_product(p_b_bc, p_ab_bc); dp = dot_product(cp, cameraNormalized)
                        enclosingTriangleId = dp > 0 ? 8 : 7
                    }
                }
            } else {
                cp = cross_product(p_ac, p_ab); dp = dot_product(cp, cameraNormalized)
                if (dp > 0) {
                    cp = cross_product(p_ac_a, p_a_ab); dp = dot_product(cp, cameraNormalized)
                    if (dp > 0) { enclosingTriangleId = 1 }
                    else {
                        cp = cross_product(p_a_ab, p_ac_ab); dp = dot_product(cp, cameraNormalized)
                        if (dp > 0) { enclosingTriangleId = 3 }
                        else {
                            cp = cross_product(p_ac_ab, p_ac_a); dp = dot_product(cp, cameraNormalized)
                            enclosingTriangleId = dp > 0 ? 15 : 2
                        }
                    }
                } else {
                    cp = cross_product(p_bc, p_ac); dp = dot_product(cp, cameraNormalized)
                    if (dp > 0) {
                        cp = cross_product(p_c_ac, p_bc_ac); dp = dot_product(cp, cameraNormalized)
                        if (dp > 0) { enclosingTriangleId = 13 }
                        else {
                            cp = cross_product(p_bc_ac, p_bc_c); dp = dot_product(cp, cameraNormalized)
                            if (dp > 0) { enclosingTriangleId = 10 }
                            else {
                                cp = cross_product(p_bc_c, p_c_ac); dp = dot_product(cp, cameraNormalized)
                                enclosingTriangleId = dp > 0 ? 11 : 12
                            }
                        }
                    } else {
                        cp = cross_product(p_ac_ab, p_ab_bc); dp = dot_product(cp, cameraNormalized)
                        if (dp > 0) { enclosingTriangleId = 4 }
                        else {
                            cp = cross_product(p_ab_bc, p_bc_ac); dp = dot_product(cp, cameraNormalized)
                            if (dp > 0) { enclosingTriangleId = 9 }
                            else {
                                cp = cross_product(p_bc_ac, p_ac_ab); dp = dot_product(cp, cameraNormalized)
                                enclosingTriangleId = dp > 0 ? 14 : 0
                            }
                        }
                    }
                }
            }
        } else {
            enclosingTriangleId = get2DEnclosingTriangle(currentFace, cameraPosSurface, i)
        }

        const nextId: string = currentFace.faceId + currentFace.ids[enclosingTriangleId]
        const next: FaceGeoPositions | undefined = triangles.find(t => t.faceId === nextId)
        if (!next) { console.log('Could not find face with id:', nextId); return }
        currentFace = next

        fullerCodeLabel.textContent = `fullercode: ${currentFace.faceId}`
        positionHeaderButtons()
    }
}

// ─── 2D enclosing triangle ────────────────────────────────────────────────────

let _g2d_Xc = 0
let _g2d_Yc = 0

function get2DEnclosingTriangle(
    faceGeo: FaceGeoPositions,
    cameraCartesian: Cesium.Cartesian3,
    levelIndex: number
): number {
    let Yc = _g2d_Yc
    let Xc = _g2d_Xc

    if (levelIndex <= transition3D2D) {
        const origin = faceGeo.vertices[0]
        const b1 = new CartesianCoord(
            faceGeo.vertices[1].x - origin.x,
            faceGeo.vertices[1].y - origin.y,
            faceGeo.vertices[1].z - origin.z
        )
        const b2 = new CartesianCoord(
            faceGeo.vertices[2].x - origin.x,
            faceGeo.vertices[2].y - origin.y,
            faceGeo.vertices[2].z - origin.z
        )
        const cameraVec = new CartesianCoord(
            cameraCartesian.x - origin.x,
            cameraCartesian.y - origin.y,
            cameraCartesian.z - origin.z
        )
        const normal = cross_product(b1, b2)
        const normSq = dot_product(normal, normal)
        if (normSq !== 0) {
            Yc = dot_product(cross_product(cameraVec, b2), normal) / normSq
            Xc = dot_product(cross_product(b1, cameraVec), normal) / normSq
        }
    }

    let ETiD = 0
    if (Yc > 0.5) {
        if (Yc > 0.75)                     { ETiD = 6;  Yc -= 0.75 }
        else if (Xc > 0.25)                { ETiD = 8;  Yc -= 0.5; Xc -= 0.25 }
        else if (Xc + Yc < 0.75)           { ETiD = 5;  Yc -= 0.5 }
        else                               { ETiD = 7;  Yc = 0.75 - Yc; Xc = 0.25 - Xc }
    } else if (Xc > 0.5) {
        if (Xc > 0.75)                     { ETiD = 11; Xc -= 0.75 }
        else if (Yc > 0.25)                { ETiD = 10; Xc -= 0.5; Yc -= 0.25 }
        else if (Yc + Xc < 0.75)           { ETiD = 13; Xc -= 0.5 }
        else                               { ETiD = 12; Yc = 0.25 - Yc; Xc = 0.75 - Xc }
    } else if (Xc + Yc < 0.5) {
        if (Yc > 0.25)                     { ETiD = 3;  Yc -= 0.25 }
        else if (Xc > 0.25)                { ETiD = 15; Xc -= 0.25 }
        else if (Xc + Yc < 0.25)           { ETiD = 1 }
        else                               { ETiD = 2;  Xc = 0.5 - Xc; Yc = 0.5 - Yc }
    } else {
        if (Yc < 0.25)                     { ETiD = 14; Yc = 0.25 - Yc; Xc = 0.5 - Xc }
        else if (Xc < 0.25)                { ETiD = 4;  Yc = 0.5 - Yc; Xc = 0.25 - Xc }
        else if (Xc + Yc > 0.75)           { ETiD = 9;  Yc = 0.5 - Yc; Xc = 0.5 - Xc }
        else                               { ETiD = 0;  Xc -= 0.25; Yc -= 0.25 }
    }

    _g2d_Xc = Xc * 4
    _g2d_Yc = Yc * 4
    return ETiD
}

// ─── Subtriangle management ───────────────────────────────────────────────────

function addSubtriangles(closestFace: FaceGeoPositions, i: number): void {
    if (!closestFace || !fullerData.viewer) return
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
