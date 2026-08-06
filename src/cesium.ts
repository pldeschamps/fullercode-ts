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

const NATO_ALPHABET_MAP: Record<string, string> = {
    '2': 'Z',
    '3': 'E',
    '5': 'W',
    '7': 'Y',
    '8': 'B',
    '9': 'G',
}
const NATO_INPUT_MAP: Record<string, string> = {
    Z: '2',
    E: '3',
    W: '5',
    Y: '7',
    B: '8',
    G: '9',
}
let natoAlphabetEnabled = false
let currentFullerCodeValue = ''
let initialNatoUrlMode = false

type ParsedFullercodeUrl = {
    code: string
    nato: boolean
}

function getDisplayCode(code: string): string {
    const normalized = code.toUpperCase()
    if (!natoAlphabetEnabled) return normalized
    return Array.from(normalized).map(ch => NATO_ALPHABET_MAP[ch] ?? ch).join('')
}

function getBaseCode(code: string): string {
    const normalized = code.toUpperCase()
    return Array.from(normalized).map(ch => NATO_INPUT_MAP[ch] ?? ch).join('')
}

function normalizeFullercodeUrlValue(value: string, nato: boolean): string {
    const code = nato ? getBaseCode(value) : value
    return code.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, MAX_FULLERCODE_LEN)
}

function syncFullerCodeInputDisplay(): void {
    const code = getBaseCode(currentFullerCodeValue || fullerCodeInput.value)
    currentFullerCodeValue = code
    fullerCodeInput.value = getDisplayCode(code)
}

function refreshDisplayedCodes(): void {
    const displayCode = getDisplayCode(currentFullerCodeValue || getBaseCode(fullerCodeInput.value))
    fullerCodeLabel.textContent = `@@${displayCode}`

    viewer.entities.values.forEach(entity => {
        if (typeof entity.id === 'string' && entity.id.startsWith('label ')) {
            const triangleId = entity.id.substring('label '.length)
            if (entity.label) {
                entity.label.text = new Cesium.ConstantProperty(getDisplayCode(triangleId))
            }
        }
    })

    if (triangleDetailsActiveEntity) {
        renderTriangleDetails()
    }
}

function setNatoAlphabetEnabled(enabled: boolean): void {
    natoAlphabetEnabled = enabled
    if (natoToggleBtn) {
        natoToggleBtn.classList.toggle('active', enabled)
        natoToggleBtn.setAttribute('aria-pressed', String(enabled))
    }
    syncFullerCodeInputDisplay()
    refreshDisplayedCodes()
}

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
// I have removed the following parameter because it has modified how the camera behavior, the altitude, the levels of triangles. It has moved the label "You Position" northward out of the screen:
//     mapProjection: new Cesium.WebMercatorProjection(Cesium.Ellipsoid.WGS84),
const viewportCenter = new Cesium.Cartesian2()
const lastSynchronizedSurfacePosition = new Cesium.Cartesian3(Number.NaN, Number.NaN, Number.NaN)
let lastSynchronizedAltitude = Number.NaN

function getViewCenterOnEllipsoid(result?: Cesium.Cartesian3): Cesium.Cartesian3 | undefined {
    const canvas = viewer.scene.canvas
    viewportCenter.x = canvas.clientWidth / 2
    viewportCenter.y = canvas.clientHeight / 2
    const position = viewer.camera.pickEllipsoid(viewportCenter, sphereEllipsoid)
    return position ? Cesium.Cartesian3.clone(position, result) : undefined
}

function getCurrentSurfacePosition(result?: Cesium.Cartesian3): Cesium.Cartesian3 {
    const center = getViewCenterOnEllipsoid(result)
    if (center) return center

    const cameraCartographic = viewer.camera.positionCartographic
    return Cesium.Cartesian3.fromRadians(
        cameraCartographic.longitude,
        cameraCartographic.latitude,
        0,
        sphereEllipsoid,
        result
    )
}

function getViewCenterCartographic(): Cesium.Cartographic {
    return sphereEllipsoid.cartesianToCartographic(getCurrentSurfacePosition())
}

if (viewer.scene.sun) viewer.scene.sun.show = false
if (viewer.scene.moon) viewer.scene.moon.show = false
viewer.scene.globe.depthTestAgainstTerrain = false

const openSeaMapLayer = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
        url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
        tilingScheme: new Cesium.WebMercatorTilingScheme({ ellipsoid: Cesium.Ellipsoid.WGS84 }),
        maximumLevel: 18,
        credit: '<a href="https://www.openseamap.org/" target="_blank" rel="noopener">&copy; OpenSeaMap contributors</a>',
    })
)

function syncOpenSeaMapVisibility(): void {
    openSeaMapLayer.show = viewer.scene.mode === Cesium.SceneMode.SCENE2D
}

syncOpenSeaMapVisibility()
viewer.scene.morphComplete.addEventListener(syncOpenSeaMapVisibility)

// Telstar controller (set after data load)
let telstarController: { rootEntity: Cesium.Entity; toggle: (show?: boolean) => void } | null = null

// ─── Triangle highlight state ─────────────────────────────────────────────────

const TRIANGLE_DEFAULT_MATERIAL = Cesium.Color.BLUE.withAlpha(0.05)
const TRIANGLE_TRANSPARENT_MATERIAL = Cesium.Color.TRANSPARENT
const TRIANGLE_DEFAULT_OUTLINE_COLOR = Cesium.Color.MAGENTA
const TRIANGLE_SELECTED_MATERIAL = TRIANGLE_DEFAULT_MATERIAL
const TRIANGLE_SELECTED_OUTLINE_COLOR = Cesium.Color.YELLOW

let selectedTriangleEntity: Cesium.Entity | null = null
let triangleDetailsLabel: HTMLElement | null = null
let triangleDetailsActiveEntity: Cesium.Entity | null = null
let triangleDetailsTab: 'S' | 'L' | 'A' = 'S'

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

function formatLength(meters: number): string {
    if (!Number.isFinite(meters)) return '-'
    return `${meters.toFixed(1)} m`
}

function hideTriangleDetails(): void {
    if (selectedTriangleEntity) {
        setTriangleHighlighted(selectedTriangleEntity, false)
    }
    selectedTriangleEntity = null
    triangleDetailsActiveEntity = null
    triangleDetailsTab = 'S'
    triangleDetailsLabel?.classList.remove('visible')
}

function renderTriangleDetails(): void {
    if (!triangleDetailsLabel || !triangleDetailsActiveEntity) return
    const rawId = triangleDetailsActiveEntity.id
    if (typeof rawId !== 'string' || !rawId.startsWith('triangle ')) {
        hideTriangleDetails()
        return
    }
    const triangleId = rawId.substring('triangle '.length)
    const face = triangles.find(t => t.faceId === triangleId)
    if (!face) return

    const [c0, c1, c2] = face.vertices.map(toC3)
    const vertices = [c0, c1, c2].map(formatVertex)
    const area = getSphericalTriangleArea(c0, c1, c2)
    const lengths: Array<[string, number]> = [
        ['AB', getCentralAngle(c0, c1) * RADIUS],
        ['BC', getCentralAngle(c1, c2) * RADIUS],
        ['AC', getCentralAngle(c2, c0) * RADIUS],
    ]

    let body = ''
    if (triangleDetailsTab === 'L') {
        body = `
            <div class="triangleDetailsRow"><span>AB</span><span>${formatLength(lengths[0][1])}</span></div>
            <div class="triangleDetailsRow"><span>BC</span><span>${formatLength(lengths[1][1])}</span></div>
            <div class="triangleDetailsRow"><span>AC</span><span>${formatLength(lengths[2][1])}</span></div>
        `
    } else if (triangleDetailsTab === 'A') {
        body = `<div class="triangleDetailsRow"><span>surface</span><span>${formatArea(area)}</span></div>`
    } else {
        body = `
            <div class="triangleDetailsRow"><span>A</span><span>${vertices[0] ?? '-'}</span></div>
            <div class="triangleDetailsRow"><span>B</span><span>${vertices[1] ?? '-'}</span></div>
            <div class="triangleDetailsRow"><span>C</span><span>${vertices[2] ?? '-'}</span></div>
        `
    }

    triangleDetailsLabel.innerHTML = `
        <div class="triangleDetailsHeader">
            <div class="triangleDetailsCode">code: ${getDisplayCode(triangleId)}</div>
            <div class="triangleDetailsActions">
                <button class="triangleDetailsTab ${triangleDetailsTab === 'S' ? 'active' : ''}" data-tab="S" aria-label="Summits">S</button>
                <button class="triangleDetailsTab ${triangleDetailsTab === 'L' ? 'active' : ''}" data-tab="L" aria-label="Lengths">L</button>
                <button class="triangleDetailsTab ${triangleDetailsTab === 'A' ? 'active' : ''}" data-tab="A" aria-label="Area">A</button>
                <button class="triangleDetailsClose" data-action="close" aria-label="Close">×</button>
            </div>
        </div>
        <div class="triangleDetailsBody">${body}</div>
    `

    triangleDetailsLabel.classList.add('visible')

    triangleDetailsLabel.querySelectorAll<HTMLButtonElement>('.triangleDetailsTab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab as 'S' | 'L' | 'A' | undefined
            if (tab) {
                triangleDetailsTab = tab
                renderTriangleDetails()
            }
        })
    })

    triangleDetailsLabel.querySelector<HTMLButtonElement>('.triangleDetailsClose')?.addEventListener('click', () => {
        hideTriangleDetails()
    })
}

function showTriangleDetails(entity: Cesium.Entity): void {
    if (!triangleDetailsLabel) return
    const rawId = entity.id
    if (typeof rawId !== 'string' || !rawId.startsWith('triangle ')) return
    const triangleId = rawId.substring('triangle '.length)
    const face = triangles.find(t => t.faceId === triangleId)
    if (!face) return
    triangleDetailsActiveEntity = entity
    renderTriangleDetails()
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
cameraLabel.textContent = 'La: - Lo: - Al: -'
viewer.container.appendChild(cameraLabel)

const fullerCodeLabel = document.createElement('div')
fullerCodeLabel.id = 'fullerCodeWidget'
fullerCodeLabel.textContent = '@@'
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

const natoToggleBtn = document.createElement('button')
natoToggleBtn.id = 'natoToggle'
natoToggleBtn.type = 'button'
natoToggleBtn.className = 'natoToggle'
natoToggleBtn.setAttribute('aria-label', 'Toggle NATO alphabet')
natoToggleBtn.setAttribute('aria-pressed', 'false')
natoToggleBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="100 55 220 245" width="24" height="24" aria-hidden="true">
        <g transform="translate(-298.79911,-689.79307)">
            <path
                d="M 531.17885,876.66156 c 0,0 8.07828,-2.92732 9.17828,-3.36655 1.1,-0.43922 3.575,-1.27688 5.5,-1.86147 18.88099,-5.73381 29.25285,-8.9784 39,-12.20024 18.20708,-5.3596 41.10422,-12.41972 5,-4.43463 -14.72261,3.56021 -29.61419,6.2839 -44.429,9.39532 -1.68905,0.53607 -5.9883,1.65751 -9.55388,2.49208 l -6.48289,1.51739 -6.96666,-6.74208 c -3.83166,-3.70814 -7.71715,-7.52958 -8.63441,-8.49208 -0.91726,-0.9625 -2.28997,-1.76368 -3.05046,-1.78041 -0.90783,-0.02 -0.75037,-0.39799 0.45847,-1.10071 1.27235,-0.73964 17.41914,-0.92101 52.26359,-0.58706 27.73232,0.26579 50.64863,0.1172 50.92513,-0.33019 0.69237,-1.12028 -0.42262,-1.6822 -6.65038,-3.3516 -2.95873,-0.79311 -10.55451,-3.08122 -16.87951,-5.0847 -14.24062,-4.51079 -20.02705,-6.2474 -36.5,-10.95433 -7.15,-2.04301 -13.4275,-4.13002 -13.95,-4.63778 -0.5225,-0.50777 -1.91191,-0.92322 -3.08758,-0.92322 -1.72448,0 -0.45113,-0.87854 -1.92014,-5.51733 -5.99923,-19.74419 -14.52062,-39.57013 -20.61292,-59.28455 -1.73741,-5.66604 -3.40475,-10.05606 -3.7052,-9.75561 -0.54875,0.54875 0.3779,5.22857 3.9716,20.05749 2.53596,10.46432 2.10797,8.49809 6.20365,28.5 1.97085,9.625 6.03312,19.08267 6.53596,20.73267 0.50283,1.65 -0.68071,4.20338 -0.13879,5.95855 0.95133,3.08115 0.74765,3.42066 -5.90563,9.84387 -3.79002,3.65895 -6.89095,6.85981 -6.89095,7.11301 0,0.2532 -1.34792,1.89846 -2.99537,3.65613 l -2.99538,3.19577 1.95044,-54.76733 c 1.71238,-48.0829 -2.29373,-54.544 -3.46364,-49.73267 -0.73555,3.025 -2.94354,10.45 -4.90664,16.5 -1.9631,6.05 -4.29904,13.475 -5.19098,16.5 -4.10736,13.6973 -8.48515,27.31146 -12.6844,40.98067 -1.227,4.01952 -1.77154,4.57469 -5.29088,5.39424 -2.15771,0.50246 -4.14811,1.21947 -4.42311,1.59336 -7.2179,2.8746 -14.89408,4.79678 -22.31914,7.18495 -13.75729,3.73652 -27.13641,8.7962 -40.9718,12.2777 -1.53499,0.34524 -2.55823,1.00417 -2.27387,1.46429 0.55759,0.90219 4.82732,0.45195 8.06477,-0.85043 1.1,-0.44251 5.825,-1.5175 10.5,-2.38885 4.675,-0.87136 11.425,-2.26286 15,-3.09222 17.46204,-4.05102 38.88358,-8.75024 42.14672,-9.24567 3.50293,-0.53184 4.00568,-0.19778 12.75,8.47192 5.00681,4.96407 9.10328,9.31222 9.10328,9.66256 0,0.35033 -23.60258,0.50433 -52.45019,0.34222 -30.0786,-0.16902 -52.07589,0.0795 -51.57265,0.58261 0.48265,0.48254 5.29773,2.20698 10.70019,3.83209 5.40246,1.62511 15.67265,4.73681 22.82265,6.91489 9.28604,2.96821 18.71467,5.46606 28,8.43353 2.2,0.71851 6.7,2.08577 10,3.03835 3.3,0.95258 6.5097,2.1194 7.13266,2.59293 0.62296,0.47354 2.13009,4.1122 3.34918,8.08592 1.2191,3.97372 3.24479,10.37494 4.50155,14.22494 2.59068,7.93637 16.90629,50.6985 19.1104,58.05724 0.39993,0.69747 -5.14735,-22.40071 -10.63368,-47.55724 -0.61947,-3.025 -2.42113,-11.125 -4.0037,-18 -5.01628,-21.7918 -5.45475,-19.15057 4.85798,-29.26298 4.90055,-4.80536 9.26505,-8.73702 9.69887,-8.73702 0.43383,0 0.46229,23.4 0.0633,52 -0.45553,32.65013 -0.87233,48.5 0.22359,52 0.522,0 -2.33493,-0.25 -2.33493,-0.25 0,0 20.04131,-54.04216 24.8565,-78.30774 z m -37.35352,54.30774 c -0.0679,-2.66976 -3.19353,-5.20749 -7.89606,-6.41095 -2.70163,-0.6914 -7.08557,-2.34203 -9.7421,-3.66806 -9.10364,-4.54418 -11.83064,-6.01508 -12.33004,-6.65062 -0.275,-0.34996 -1.53584,-1.34393 -2.80187,-2.20882 -4.83284,-3.30154 -16.02997,-14.78251 -18.90317,-19.38235 -4.68856,-7.50614 -7.31973,-12.85384 -9.31353,-18.9292 -2.23114,-6.79857 -5.62612,-11.2432 -7.30885,-9.56859 -1.50313,1.49588 2.45203,14.42612 7.05633,23.06859 7.14713,13.41549 12.63076,19.94532 23.77109,28.30631 8.6711,6.5078 20.76978,12.6709 29.5,15.02739 7.01316,1.89301 8.00709,1.94494 7.9682,0.4163 z m 40.0318,-1.35253 c 23.25776,-6.21694 45.27001,-26.00232 54.40093,-48.89747 6.35421,-15.93274 6.63241,-18.69671 1.63091,-16.20319 -1.69021,0.84266 -2.69399,2.45239 -3.24957,5.21124 -0.73559,3.6527 -8.30959,20.31995 -9.76646,21.49195 -0.34185,0.275 -1.94775,2.27952 -3.56867,4.45448 -3.05785,4.10303 -12.02068,13.29914 -14.66387,15.04552 -0.83243,0.55 -3.93671,2.60086 -6.89839,4.55746 -7.10252,4.6922 -13.26447,7.56171 -19.38488,9.0272 -5.78067,1.38413 -8.00435,2.98554 -8.22569,5.92382 -0.1145,1.52013 0.30337,1.95807 1.53416,1.60783 0.93034,-0.26475 4.61653,-1.26322 8.19153,-2.21884 z M 430.89026,829.3607 c 2.76812,-9.02769 5.65824,-15.22755 10.64092,-22.82683 5.69452,-8.68491 17.84457,-20.74065 24.11573,-23.92852 2.04062,-1.03733 3.93522,-2.11105 4.21022,-2.38605 1.25902,-1.25902 9.68339,-5.00526 11.25,-5.00278 0.9625,0.002 1.75,-0.3718 1.75,-0.82962 0,-0.45782 2.1375,-1.24532 4.75,-1.75 2.6125,-0.50468 4.75689,-1.3676 4.76531,-1.9176 0.008,-0.55 0.37445,-1.56568 0.81338,-2.25706 1.43684,-2.26321 -2.40973,-2.62545 -8.21701,-0.77381 -7.96757,2.54044 -25.02858,11.05791 -28.79741,14.3767 -8.63191,7.60116 -11.21557,10.26805 -16.06427,16.58168 -2.8875,3.7599 -5.25,7.45185 -5.25,8.20433 0,0.75249 -0.45,1.36816 -1,1.36816 -0.55,0 -1,0.45221 -1,1.0049 0,0.5527 -1.16904,3.3652 -2.59786,6.25 -2.6213,5.29244 -5.36837,13.88304 -5.39027,16.85643 -0.009,1.17408 0.65521,1.48381 2.44642,1.14139 1.78292,-0.34082 2.76504,-1.47034 3.57484,-4.11132 z m 162.96687,4.50782 c 0,-0.19292 -0.39658,-1.65542 -0.88129,-3.25 -3.2055,-10.54525 -4.63095,-14.39922 -5.3258,-14.39922 -0.4361,0 -0.79291,-1.0699 -0.79291,-2.37756 0,-1.30765 -0.675,-2.93775 -1.5,-3.62244 -0.825,-0.68469 -1.5,-1.7114 -1.5,-2.28158 0,-1.72198 -10.46833,-15.2182 -15,-19.33863 -8.17487,-7.43304 -10.88638,-9.4416 -16.86656,-12.49397 -3.64839,-1.8622 -6.85844,-3.61082 -7.13344,-3.88582 -0.85659,-0.85659 -13.30755,-4.87038 -17.26891,-5.56695 -3.699,-0.65043 -3.75119,-0.61613 -2.81384,1.84929 0.52528,1.38161 0.68379,2.78328 0.35224,3.11484 -0.33155,0.33155 0.37038,0.60282 1.55986,0.60282 3.95689,0 14.55635,4.26406 23.00706,9.25551 8.43661,4.98313 19.49088,14.08387 18.41449,15.16025 -0.32133,0.32133 0.16577,0.58424 1.08243,0.58424 0.91667,0 1.66667,0.61197 1.66667,1.35993 0,0.74796 1.125,2.20476 2.5,3.23735 1.375,1.03258 2.5,2.27425 2.5,2.75926 0,0.48501 1.52087,3.4157 3.3797,6.51265 3.13298,5.21975 7.02716,14.99738 7.80099,19.58696 0.18139,1.07589 1.45245,2.26853 2.82456,2.65032 3.12228,0.86878 3.99475,0.98732 3.99475,0.54275 z"
                fill="currentColor"
                stroke="#0b5fe8"
                stroke-width="2.9"
                stroke-miterlimit="4"
            />
        </g>
    </svg>
`
viewer.container.appendChild(natoToggleBtn)

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
    <span class="app-icon googleMapsIcon" aria-hidden="true">G</span>
    <span>Google Maps</span>
  </button>
  <button class="shareOption" data-app="applemaps" aria-label="Open in Apple Maps">
    <span class="app-icon appleMapsIcon" aria-hidden="true">A</span>
    <span>Apple Maps</span>
  </button>
  <button class="shareOption" data-app="waze" aria-label="Open in Waze">
    <span class="app-icon wazeIcon" aria-hidden="true">W</span>
    <span>Waze</span>
  </button>
  <button class="shareOption" data-app="herewego" aria-label="Open in Here We Go">
    <span class="app-icon hereWeGoIcon" aria-hidden="true">H</span>
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
            natoToggleBtn.style.left = centerRect.left - containerRect.left + centerRect.width + 8 + 'px'
            natoToggleBtn.style.top = rect.top - containerRect.top + 'px'
            const natoRect = natoToggleBtn.getBoundingClientRect()
            telstarToggleBtn.style.left = natoRect.left - containerRect.left + natoRect.width + 8 + 'px'
            telstarToggleBtn.style.top = rect.top - containerRect.top + 'px'
        } catch {
            natoToggleBtn.style.left = '380px'
            natoToggleBtn.style.top = '8px'
            telstarToggleBtn.style.left = '460px'
            telstarToggleBtn.style.top = '8px'
        }
        shareMenu.style.left = shareRect.left - containerRect.left + 'px'
        shareMenu.style.top = shareRect.bottom - containerRect.top + 4 + 'px'
    } catch {
        fullerCodeCopyBtn.style.left = '220px'
        fullerCodeShareBtn.style.left = '300px'
        shareMenu.style.left = '300px'
        shareMenu.style.top = '40px'
        natoToggleBtn.style.left = '380px'
        natoToggleBtn.style.top = '8px'
        telstarToggleBtn.style.left = '460px'
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
        const carto = getViewCenterCartographic()
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
    let code = getBaseCode(currentFullerCodeValue || fullerCodeInput.value).toUpperCase()
    if (!code) {
        code = getBaseCode((fullerCodeLabel.textContent ?? '').trim()).toUpperCase()
    }
    const hash = code
        ? natoAlphabetEnabled
            ? '#nato@@' + getDisplayCode(code)
            : '#' + code
        : ''
    const url = 'https://www.fullercode.org/index.html' + hash
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

natoToggleBtn.addEventListener('click', () => {
    setNatoAlphabetEnabled(!natoAlphabetEnabled)
})

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
    ? [5_000_000, 1_800_000, 600_000, 140_000, 60_000, 6_000, 1200, 400, 120, 16, 4]
    : [6_500_000, 2_600_000, 1_000_000, 200_000, 100_000, 10_000, 1800, 700, 170, 50, 10]
const LevelHeights2D = [5_000_000, 1_800_000, 600_000, 140_000, 60_000, 10_000, 6_000, 400, 120, 16, 4]

fullerCodeInput.maxLength = MAX_FULLERCODE_LEN
fullerCodeInput.addEventListener('input', function () {
    const raw = (this.value ?? '').toUpperCase()
    const normalized = getBaseCode(raw)
    let filtered = ''
    for (let i = 0; i < normalized.length && filtered.length < MAX_FULLERCODE_LEN; i++) {
        const ch = normalized[i]
        if (i === 0 ? ALLOWED_FIRST.includes(ch) : ALLOWED_REST.includes(ch)) filtered += ch
    }
    currentFullerCodeValue = filtered
    const displayValue = getDisplayCode(filtered)
    if (this.value !== displayValue) this.value = displayValue
    if (filtered.length > 1) {
        const idx = Math.min(filtered.length - 1, LevelHeights.length - 1)
        const prevIdx = Math.max(filtered.length - 2, 0)
        cameraHeight = (LevelHeights[idx] + LevelHeights[prevIdx]) / 2
    } else {
        cameraHeight = 7_000_000
    }
})

fullerCodeInput.addEventListener('keypress', function (e: KeyboardEvent) {
    if (e.key === 'Enter') flyToCode(currentFullerCodeValue || this.value.trim())
})

function flyToCode(code: string): void {
    const baseCode = getBaseCode(code).toUpperCase()
    if (!baseCode) { console.log('invalid code'); return }
    if (!fullerData.facesGeoPositions) { console.log('Cannot fly: data not ready'); return }

    let targetTriangle = triangles.find(t => t.faceId === baseCode)
    if (!targetTriangle) {
        try {
            createLevels(baseCode.length)
            for (let i = 1; i <= baseCode.length; i++) {
                const partial = baseCode.substring(0, i)
                const sub = triangles.find(t => t.faceId === partial)
                if (sub) addSubtriangles(sub, i - 1)
                else console.log('Could not find parent triangle for:', partial)
            }
            targetTriangle = triangles.find(t => t.faceId === baseCode)
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
        console.log('Fullercode not found:', baseCode)
    }
}

// ─── URL parsing ──────────────────────────────────────────────────────────────

function parseFullercodeFromUrl(): ParsedFullercodeUrl | null {
    let code: string | null = null
    let nato = false

    if (window.location.hash && window.location.hash.length > 1) {
        let h = decodeURIComponent(window.location.hash.substring(1)).trim()
        if (h.toUpperCase().startsWith('NATO')) {
            nato = true
            h = h.substring(4).replace(/^@+/, '')
        } else if (h.startsWith('@')) {
            h = h.replace(/^@+/, '')
        }
        if (h.length > 0) code = h.split(/[/?&#]/)[0]
    }

    if (!code && window.location.search && window.location.search.length > 1) {
        const raw = window.location.search.substring(1)
        if (!raw.includes('=')) {
            code = raw.split('&')[0]
        } else {
            for (const p of raw.split('&')) {
                const [, val] = p.split('=')
                if (val) { code = val; break }
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

    if (!code && !nato) return null
    if (!code && nato) return { code: '', nato }
    const normalized = normalizeFullercodeUrlValue(code ?? '', nato)
    if (!normalized) return null
    return { code: normalized, nato }
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
    position: new Cesium.CallbackPositionProperty((_time, result) => getCurrentSurfacePosition(result), false),
    point: {
        pixelSize: 5,
        color: Cesium.Color.RED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
        text: 'your position',
        font: '24px sans-serif',
        pixelOffset: new Cesium.Cartesian2(0, -12),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
})

const entitiesLevels: Cesium.Entity[] = []
entitiesLevels.push(viewer.entities.add(new Cesium.Entity()))
entitiesLevels.push(viewer.entities.add(new Cesium.Entity()))

const addedSub: string[] = []

// ─── Initialisation on data load ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const initUrl = parseFullercodeFromUrl()
    initialNatoUrlMode = !!initUrl?.nato
    if (initialNatoUrlMode) {
        setNatoAlphabetEnabled(true)
        if (telstarController) {
            telstarController.toggle(false)
            telstarToggleBtn.classList.toggle('active', false)
        }
    }
    const interval = setInterval(() => {
        if (fullerData.facesPositions) {
            console.log('Data loaded, initializing...')
            addPolygons(fullerData.facesGeoPositions!, entitiesLevels[0])
            synchronizeCurrentPosition(true)
            if (initUrl?.code) {
                fullerCodeInput.value = initUrl.code
                fullerCodeInput.dispatchEvent(new Event('input', { bubbles: true }))
                setTimeout(() => flyToCode(initUrl.code), 1000)
            }
            clearInterval(interval)
        }
    }, 100)
})

loadIcosahedron().then(({ vertices, faces }) => {
    try {
        telstarController = initTelstar(viewer, vertices, faces, RADIUS, { fillAlpha: 0.2, segments: 12, offset: 30 })
        if (initialNatoUrlMode) {
            telstarController.toggle(false)
        }
        // ensure button reflects initial state
        telstarToggleBtn.classList.toggle('active', !!telstarController?.rootEntity.show)
    } catch (e) {
        console.error('Failed to initialize Telstar:', e)
    }
}).catch(err => console.error('Failed to load icosahedron:', err))

// ─── Camera events ────────────────────────────────────────────────────────────

viewer.scene.preRender.addEventListener(() => synchronizeCurrentPosition())
viewer.scene.morphComplete.addEventListener(() => synchronizeCurrentPosition(true))
synchronizeCurrentPosition(true)

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
            text: getDisplayCode(triangleId),
            font: labelFont,
            fillColor: Cesium.Color.MAGENTA.withAlpha(0.8),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
    })
}

// ─── Camera label update ──────────────────────────────────────────────────────

function updateCameraLabel(carto: Cesium.Cartographic, altitude: number): void {
    const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(6)
    const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(6)
    cameraLabel.textContent = `La:${lat} Lo:${lon} Al:${altitude.toFixed(0)}`
}

function synchronizeCurrentPosition(force = false): void {
    const surfacePosition = getCurrentSurfacePosition()
    const altitude = viewer.camera.positionCartographic.height
    const positionChanged = !Cesium.Cartesian3.equalsEpsilon(
        surfacePosition,
        lastSynchronizedSurfacePosition,
        Cesium.Math.EPSILON12,
        0.001
    )
    const altitudeChanged = Math.abs(altitude - lastSynchronizedAltitude) >= 0.01
    if (!force && !positionChanged && !altitudeChanged) return

    Cesium.Cartesian3.clone(surfacePosition, lastSynchronizedSurfacePosition)
    lastSynchronizedAltitude = altitude

    const cartographic = sphereEllipsoid.cartesianToCartographic(surfacePosition)
    updateCameraLabel(cartographic, altitude)
    findEnclosingTriangle(cartographic, altitude)
}

// ─── Enclosing triangle finder ────────────────────────────────────────────────

function findEnclosingTriangle(cameraCartographic: Cesium.Cartographic, cameraHeight: number): void {
    const facesGeoPositions = fullerData.facesGeoPositions
    if (!facesGeoPositions) return

    const cameraUnitSphere = new UnitSphereCartesian(cameraCartographic)
    const cameraPosSurface: Vec3 = {
        x: cameraUnitSphere.x * RADIUS,
        y: cameraUnitSphere.y * RADIUS,
        z: cameraUnitSphere.z * RADIUS,
    }

    const levelIndex = getVisibleLevelIndex(cameraHeight)
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

        currentFullerCodeValue = currentFace.faceId
        fullerCodeLabel.textContent = `@@${getDisplayCode(currentFace.faceId)}`
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

function getLevelIndex(height: number, levelHeights = LevelHeights): number {
    for (let i = 0; i < levelHeights.length; i++) {
        if (height >= levelHeights[i]) return i
    }
    return levelHeights.length
}

function getVisibleLevelIndex(height: number): number {
    const levelHeights = viewer.scene.mode === Cesium.SceneMode.SCENE2D
        ? LevelHeights2D
        : LevelHeights
    return Math.min(getLevelIndex(height, levelHeights), MAX_FULLERCODE_LEN - 1)
}
