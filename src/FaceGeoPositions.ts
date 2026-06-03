import * as Cesium from 'cesium'
import { RADIUS } from './state'

export class FaceGeoPositions {
    faceId: string
    vertices: Cesium.Cartesian3[]
    subtrianglesIds: string
    center: Cesium.Cartesian3
    parentOrientation: boolean
    v: Cesium.Cartesian3[]
    ids: string[]

    constructor(
        faceId: string,
        vertices: Cesium.Cartesian3[],
        subtrianglesIds: string,
        parentOrientation = true
    ) {
        this.faceId = faceId
        this.vertices = vertices
        this.subtrianglesIds = subtrianglesIds
        this.parentOrientation = parentOrientation
        this.v = []
        this.ids = []
        this.center = this.computeCenter()
    }

    private computeCenter(): Cesium.Cartesian3 {
        if (this.vertices.length !== 3) return new Cesium.Cartesian3()
        let x = this.vertices[0].x + this.vertices[1].x + this.vertices[2].x
        let y = this.vertices[0].y + this.vertices[1].y + this.vertices[2].y
        let z = this.vertices[0].z + this.vertices[1].z + this.vertices[2].z
        const length = Math.sqrt(x * x + y * y + z * z)
        x = (x / length) * RADIUS
        y = (y / length) * RADIUS
        z = (z / length) * RADIUS
        return new Cesium.Cartesian3(x, y, z)
    }
}
