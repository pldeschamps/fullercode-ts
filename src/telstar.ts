import * as Cesium from 'cesium'
import type { Vec3 } from './Vec3'

export interface IcosaVertex { id: number; pos: Vec3 }
export interface IcosaFace { id: string; vertices: number[] }

function toC3(v: Vec3): Cesium.Cartesian3 {
    return new Cesium.Cartesian3(v.x, v.y, v.z)
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}-${b}` : `${b}-${a}`
}

function interpolateOnSphere(a: Vec3, b: Vec3, t: number, RADIUS: number): Vec3 {
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

function sampleGreatCircle(a: Vec3, b: Vec3, segments: number, RADIUS: number): Vec3[] {
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

export function initTelstar(
    viewer: Cesium.Viewer,
    vertices: IcosaVertex[],
    faces: IcosaFace[],
    RADIUS: number,
    options?: { fillAlpha?: number; segments?: number; offset?: number }
): { rootEntity: Cesium.Entity; toggle: (show?: boolean) => void } {
    const fillAlpha = options?.fillAlpha ?? 0.2
    const segments = options?.segments ?? 12
    const offset = options?.offset ?? 30

    const verticesById = new Map<number, Vec3>(vertices.map(v => [v.id, v.pos]))
    const soccerBallRoot = viewer.entities.add(new Cesium.Entity({ id: 'telstarRoot' }))

    const edgeMap = new Map<string, { a: number; b: number; p1: Vec3; p2: Vec3 }>()
    const truncationRatio = 1 / 3

    const addBallEdge = (p0: Vec3, p1: Vec3): void => {
        viewer.entities.add({
            parent: soccerBallRoot,
            polyline: {
                positions: [toC3(p0), toC3(p1)],
                width: 6,
                material: new Cesium.ColorMaterialProperty(Cesium.Color.BLACK.withAlpha(0.2)),
                arcType: Cesium.ArcType.GEODESIC,
            },
        })
    }

    const getAngleAroundVertex = (vertex: Vec3, point: Vec3): number => {
        const normal = { x: vertex.x / RADIUS, y: vertex.y / RADIUS, z: vertex.z / RADIUS }
        const base = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
        const tangent1 = {
            x: normal.y * base.z - normal.z * base.y,
            y: normal.z * base.x - normal.x * base.z,
            z: normal.x * base.y - normal.y * base.x,
        }
        const len1 = Math.sqrt(tangent1.x * tangent1.x + tangent1.y * tangent1.y + tangent1.z * tangent1.z)
        const t1 = { x: tangent1.x / len1, y: tangent1.y / len1, z: tangent1.z / len1 }
        const tangent2 = {
            x: normal.y * t1.z - normal.z * t1.y,
            y: normal.z * t1.x - normal.x * t1.z,
            z: normal.x * t1.y - normal.y * t1.x,
        }
        const vec = {
            x: point.x - vertex.x,
            y: point.y - vertex.y,
            z: point.z - vertex.z,
        }
        const angle = Math.atan2(
            vec.x * tangent2.x + vec.y * tangent2.y + vec.z * tangent2.z,
            vec.x * t1.x + vec.y * t1.y + vec.z * t1.z
        )
        return angle
    }

    const createSpherePoint = (points: Vec3[]): Vec3 => {
        const avg = points.reduce(
            (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
            { x: 0, y: 0, z: 0 }
        )
        const len = Math.sqrt(avg.x * avg.x + avg.y * avg.y + avg.z * avg.z)
        return { x: (avg.x / len) * RADIUS, y: (avg.y / len) * RADIUS, z: (avg.z / len) * RADIUS }
    }

    // vertex markers (optional)
    vertices.forEach(({ id, pos }) => {
        viewer.entities.add({
            parent: soccerBallRoot,
            position: toC3(pos),
            point: { pixelSize: 3, color: Cesium.Color.MAGENTA },
            label: {
                text: id.toString(),
                font: '24px sans-serif',
                pixelOffset: new Cesium.Cartesian2(0, -12),
            },
        })
    })

    faces.forEach(face => {
        for (let i = 0; i < 3; i++) {
            const a = face.vertices[i]
            const b = face.vertices[(i + 1) % 3]
            const key = edgeKey(a, b)
            if (!edgeMap.has(key)) {
                const va = verticesById.get(a)
                const vb = verticesById.get(b)
                if (!va || !vb) continue
                edgeMap.set(key, {
                    a,
                    b,
                    p1: interpolateOnSphere(va, vb, truncationRatio, RADIUS),
                    p2: interpolateOnSphere(va, vb, 1 - truncationRatio, RADIUS),
                })
            }
        }
    })

    // draw hexagon-border edges (connect truncated points across each triangular face)
    const getEdgePoints = (a: number, b: number): { nearA: Vec3; nearB: Vec3 } | null => {
        const key = edgeKey(a, b)
        const edge = edgeMap.get(key)
        if (!edge) return null
        if (edge.a === a && edge.b === b) {
            return { nearA: edge.p1, nearB: edge.p2 }
        }
        return { nearA: edge.p2, nearB: edge.p1 }
    }

    faces.forEach(face => {
        const [a, b, c] = face.vertices
        const ab = getEdgePoints(a, b)
        const bc = getEdgePoints(b, c)
        const ca = getEdgePoints(c, a)
        if (!ab || !bc || !ca) return

        const ab1 = ab.nearA
        const ab2 = ab.nearB
        const bc1 = bc.nearA
        const bc2 = bc.nearB
        const ca1 = ca.nearA
        const ca2 = ca.nearB

        addBallEdge(ab2, bc1)
        addBallEdge(bc1, bc2)
        addBallEdge(bc2, ca1)
        addBallEdge(ca1, ca2)
        addBallEdge(ca2, ab1)
        addBallEdge(ab1, ab2)
    })

    const pentagonPointsByVertex = new Map<number, Vec3[]>()
    edgeMap.forEach(({ a, b, p1, p2 }) => {
        pentagonPointsByVertex.set(a, [...(pentagonPointsByVertex.get(a) ?? []), p1])
        pentagonPointsByVertex.set(b, [...(pentagonPointsByVertex.get(b) ?? []), p2])
    })

    const fallbackTriangles: Vec3[][] = []
    pentagonPointsByVertex.forEach((points, vertexId) => {
        if (points.length < 3) return
        const vertex = verticesById.get(vertexId)
        if (!vertex) return
        points.sort((pA, pB) => getAngleAroundVertex(vertex, pA) - getAngleAroundVertex(vertex, pB))
        const center = createSpherePoint(points)
        for (let i = 0; i < points.length; i++) {
            const next = points[(i + 1) % points.length]
            const arc = sampleGreatCircle(points[i], next, segments, RADIUS)
            for (let j = 0; j < arc.length - 1; j++) {
                const triPositions = [center, arc[j], arc[j + 1]]
                fallbackTriangles.push(triPositions)
            }
            addBallEdge(points[i], next)
        }
    })

    // draw fallback raised polygons (always used for compatibility)
    for (const tri of fallbackTriangles) {
        const raised = tri.map(p => raiseAboveSphere(p, offset))
        viewer.entities.add({
            parent: soccerBallRoot,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(raised.map(toC3)),
                perPositionHeight: true,
                material: new Cesium.ColorMaterialProperty(Cesium.Color.BLACK.withAlpha(fillAlpha)),
                outline: false,
            },
        })
    }

    function toggle(show = true): void {
        soccerBallRoot.show = show
    }

    return { rootEntity: soccerBallRoot, toggle }
}

export default initTelstar
