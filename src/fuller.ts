import * as Cesium from 'cesium'
import { FaceGeoPositions } from './FaceGeoPositions'
import { fullerData, RADIUS, getViewer } from './state'

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

export async function loadIcosahedron(): Promise<void> {
    const response = await fetch('icosahedron.json')
    const data: IcosahedronData = await response.json()
    const viewer = getViewer()

    const verts: Record<number, Cesium.Cartesian3> = {}
    data.vertices.forEach(v => {
        const pos = Cesium.Cartesian3.fromElements(v.x * RADIUS, v.y * RADIUS, v.z * RADIUS)
        verts[v.id] = pos
        viewer.entities.add({
            position: pos,
            point: { pixelSize: 3, color: Cesium.Color.MAGENTA },
            label: {
                text: v.id.toString(),
                font: '24px sans-serif',
                pixelOffset: new Cesium.Cartesian2(0, -12),
            },
        })
    })

    const facesGeoPositions = data.faces.map(face => {
        const positions = face.vertices.map(id => {
            const vert = data.vertices.find(v => v.id === id)!
            return Cesium.Cartesian3.fromElements(vert.x * RADIUS, vert.y * RADIUS, vert.z * RADIUS)
        })
        return new FaceGeoPositions(face.id, positions, face.subtrianglesids)
    })

    fullerData.facesGeoPositions = facesGeoPositions
    fullerData.facesPositions = facesGeoPositions.map(f => f.vertices)
    fullerData.viewer = viewer
}
