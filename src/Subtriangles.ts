import * as Cesium from 'cesium'
import { FaceGeoPositions } from './FaceGeoPositions'
import { RADIUS } from './state'

export class Subtriangles {
    faceGeoPos: FaceGeoPositions
    v: Cesium.Cartesian3[]
    a: Cesium.Cartesian3
    b: Cesium.Cartesian3
    c: Cesium.Cartesian3
    ab: Cesium.Cartesian3
    bc: Cesium.Cartesian3
    ac: Cesium.Cartesian3
    ac_ab: Cesium.Cartesian3
    ab_bc: Cesium.Cartesian3
    bc_ac: Cesium.Cartesian3
    a_ab: Cesium.Cartesian3
    ab_b: Cesium.Cartesian3
    b_bc: Cesium.Cartesian3
    bc_c: Cesium.Cartesian3
    c_ac: Cesium.Cartesian3
    ac_a: Cesium.Cartesian3
    subFaces: FaceGeoPositions[]

    constructor(faceGeoPos: FaceGeoPositions) {
        this.faceGeoPos = faceGeoPos
        this.v = []
        this.a = faceGeoPos.vertices[0]
        this.b = faceGeoPos.vertices[1]
        this.c = faceGeoPos.vertices[2]

        // First-level midpoints
        this.ab = Subtriangles.midpoint(this.a, this.b)
        this.bc = Subtriangles.midpoint(this.b, this.c)
        this.ac = Subtriangles.midpoint(this.a, this.c)

        // Second-level midpoints
        this.ac_ab = Subtriangles.midpoint(this.ac, this.ab)
        this.ab_bc = Subtriangles.midpoint(this.ab, this.bc)
        this.bc_ac = Subtriangles.midpoint(this.bc, this.ac)

        this.a_ab = Subtriangles.midpoint(this.a, this.ab)
        this.ab_b = Subtriangles.midpoint(this.ab, this.b)
        this.b_bc = Subtriangles.midpoint(this.b, this.bc)
        this.bc_c = Subtriangles.midpoint(this.bc, this.c)
        this.c_ac = Subtriangles.midpoint(this.c, this.ac)
        this.ac_a = Subtriangles.midpoint(this.ac, this.a)

        this.v.push(
            this.a, this.b, this.c,
            this.ab, this.bc, this.ac,
            this.a_ab, this.ac_ab, this.ac_a,
            this.b_bc, this.ab_bc, this.ab_b,
            this.c_ac, this.bc_ac, this.bc_c
        )
        faceGeoPos.v = this.v

        let ids: string[]
        const up = faceGeoPos.parentOrientation

        if (faceGeoPos.faceId.length > 1 && !faceGeoPos.parentOrientation) {
            const pBox = [0, 2, 1, 8, 9, 10, 7, 6, 13, 14, 15, 12, 11, 3, 4, 5]
            ids = pBox.map(i => faceGeoPos.subtrianglesIds[i])
        } else {
            ids = faceGeoPos.subtrianglesIds.split('')
        }
        faceGeoPos.ids = ids

        this.subFaces = [
            new FaceGeoPositions(faceGeoPos.faceId + ids[0],  [this.ac_ab, this.ab_bc, this.bc_ac], faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[1],  [this.a, this.a_ab, this.ac_a],       faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[2],  [this.ac_ab, this.ac_a, this.a_ab],   faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[3],  [this.a_ab, this.ab, this.ac_ab],     faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[4],  [this.ab_bc, this.ac_ab, this.ab],    faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[5],  [this.ab, this.ab_b, this.ab_bc],     faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[6],  [this.ab_b, this.b, this.b_bc],       faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[7],  [this.b_bc, this.ab_bc, this.ab_b],   faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[8],  [this.ab_bc, this.b_bc, this.bc],     faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[9],  [this.bc, this.bc_ac, this.ab_bc],    faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[10], [this.bc_ac, this.bc, this.bc_c],     faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[11], [this.c_ac, this.bc_c, this.c],       faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[12], [this.bc_c, this.c_ac, this.bc_ac],   faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[13], [this.ac, this.bc_ac, this.c_ac],     faceGeoPos.subtrianglesIds, up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[14], [this.bc_ac, this.ac, this.ac_ab],    faceGeoPos.subtrianglesIds, !up),
            new FaceGeoPositions(faceGeoPos.faceId + ids[15], [this.ac_a, this.ac_ab, this.ac],     faceGeoPos.subtrianglesIds, up),
        ]
    }

    static midpoint(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3, radius = RADIUS): Cesium.Cartesian3 {
        const x = p1.x + p2.x
        const y = p1.y + p2.y
        const z = p1.z + p2.z
        const length = Math.sqrt(x * x + y * y + z * z)
        return new Cesium.Cartesian3(
            (x * radius) / length,
            (y * radius) / length,
            (z * radius) / length
        )
    }

    static gravityCenter(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3, p3: Cesium.Cartesian3, radius = RADIUS): Cesium.Cartesian3 {
        const x = p1.x + p2.x + p3.x
        const y = p1.y + p2.y + p3.y
        const z = p1.z + p2.z + p3.z
        const length = Math.sqrt(x * x + y * y + z * z)
        return new Cesium.Cartesian3((x / length) * radius, (y / length) * radius, (z / length) * radius)
    }

    static normalizeVector(v: Cesium.Cartesian3): Cesium.Cartesian3 {
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
        return new Cesium.Cartesian3(v.x / length, v.y / length, v.z / length)
    }

    static vectorialProduct(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3): Cesium.Cartesian3 {
        return new Cesium.Cartesian3(
            p1.y * p2.z - p1.z * p2.y,
            p1.z * p2.x - p1.x * p2.z,
            p1.x * p2.y - p1.y * p2.x
        )
    }

    static orthogonalVector(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3): Cesium.Cartesian3 {
        return Subtriangles.normalizeVector(Subtriangles.vectorialProduct(p1, p2))
    }

    static rotateTowards(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3, angle: number): Cesium.Cartesian3 {
        const axis = Subtriangles.orthogonalVector(p1, p2)
        const { x, y, z } = axis
        if (x === 0 && y === 0 && z === 0) return p1

        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const dot = p1.x * x + p1.y * y + p1.z * z

        return new Cesium.Cartesian3(
            p1.x * cosA + (y * p1.z - z * p1.y) * sinA + x * dot * (1 - cosA),
            p1.y * cosA + (z * p1.x - x * p1.z) * sinA + y * dot * (1 - cosA),
            p1.z * cosA + (x * p1.y - y * p1.x) * sinA + z * dot * (1 - cosA)
        )
    }
}
