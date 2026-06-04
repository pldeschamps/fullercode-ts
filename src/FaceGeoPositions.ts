import { RADIUS } from './state'
import type { Vec3 } from './Vec3'

export class FaceGeoPositions {
    faceId: string
    vertices: Vec3[]
    subtrianglesIds: string
    center: Vec3
    parentOrientation: boolean
    v: Vec3[]
    ids: string[]

    constructor(
        faceId: string,
        vertices: Vec3[],
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

    private computeCenter(): Vec3 {
        if (this.vertices.length !== 3) return { x: 0, y: 0, z: 0 }
        let x = this.vertices[0].x + this.vertices[1].x + this.vertices[2].x
        let y = this.vertices[0].y + this.vertices[1].y + this.vertices[2].y
        let z = this.vertices[0].z + this.vertices[1].z + this.vertices[2].z
        const length = Math.sqrt(x * x + y * y + z * z)
        x = (x / length) * RADIUS
        y = (y / length) * RADIUS
        z = (z / length) * RADIUS
        return { x, y, z }
    }
}
