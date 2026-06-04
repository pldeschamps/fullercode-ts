import { FaceGeoPositions } from './FaceGeoPositions'
import { RADIUS } from './state'
import type { Vec3 } from './Vec3'

export class Subtriangles {
    faceGeoPos: FaceGeoPositions
    v: Vec3[]
    a: Vec3
    b: Vec3
    c: Vec3
    ab: Vec3
    bc: Vec3
    ac: Vec3
    ac_ab: Vec3
    ab_bc: Vec3
    bc_ac: Vec3
    a_ab: Vec3
    ab_b: Vec3
    b_bc: Vec3
    bc_c: Vec3
    c_ac: Vec3
    ac_a: Vec3
    subFaces: FaceGeoPositions[]

    constructor(faceGeoPos: FaceGeoPositions) {
        this.faceGeoPos = faceGeoPos
        this.v = []
        this.a = faceGeoPos.vertices[0]
        this.b = faceGeoPos.vertices[1]
        this.c = faceGeoPos.vertices[2]

        this.ab = Subtriangles.midpoint(this.a, this.b)
        this.bc = Subtriangles.midpoint(this.b, this.c)
        this.ac = Subtriangles.midpoint(this.a, this.c)

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

    static midpoint(p1: Vec3, p2: Vec3, radius = RADIUS): Vec3 {
        const x = p1.x + p2.x
        const y = p1.y + p2.y
        const z = p1.z + p2.z
        const length = Math.sqrt(x * x + y * y + z * z)
        return { x: (x * radius) / length, y: (y * radius) / length, z: (z * radius) / length }
    }

    static normalizeVector(v: Vec3): Vec3 {
        const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
        return { x: v.x / length, y: v.y / length, z: v.z / length }
    }

    static vectorialProduct(p1: Vec3, p2: Vec3): Vec3 {
        return {
            x: p1.y * p2.z - p1.z * p2.y,
            y: p1.z * p2.x - p1.x * p2.z,
            z: p1.x * p2.y - p1.y * p2.x,
        }
    }

    static orthogonalVector(p1: Vec3, p2: Vec3): Vec3 {
        return Subtriangles.normalizeVector(Subtriangles.vectorialProduct(p1, p2))
    }

}
