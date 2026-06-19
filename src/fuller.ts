import { FaceGeoPositions } from './FaceGeoPositions'
import { fullerData, RADIUS } from './state'
import type { Vec3 } from './Vec3'

interface IcosahedronVertex {
    id: number
    x: number
    y: number
    z: number
}

interface IcosahedronFace {
    id: string
    vertices: number[]
    subtrianglesids: string
}

interface IcosahedronData {
    vertices: IcosahedronVertex[]
    faces: IcosahedronFace[]
}

interface IcosahedronLoadResult {
    vertices: Array<{ id: number; pos: Vec3 }>
    faces: IcosahedronFace[]
}

export async function loadIcosahedron(): Promise<IcosahedronLoadResult> {
    const response = await fetch('icosahedron.json')
    const data: IcosahedronData = await response.json()

    const verts: Record<number, Vec3> = {}
    const vertices = data.vertices.map(v => {
        const pos: Vec3 = { x: v.x * RADIUS, y: v.y * RADIUS, z: v.z * RADIUS }
        verts[v.id] = pos
        return { id: v.id, pos }
    })

    const facesGeoPositions = data.faces.map(face => {
        const positions = face.vertices.map(id => verts[id])
        return new FaceGeoPositions(face.id, positions, face.subtrianglesids)
    })

    fullerData.facesGeoPositions = facesGeoPositions
    fullerData.facesPositions = facesGeoPositions.map(f => f.vertices)

    return { vertices, faces: data.faces }
}
