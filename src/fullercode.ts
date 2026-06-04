import { CartesianCoord } from './CartesianCoord'
import { cross_product, dot_product } from './vectorOps'
import type { FaceGeoPositions } from './FaceGeoPositions'
import type { Vec3 } from './Vec3'

export function findClosestFace(
    faces: FaceGeoPositions[],
    queryPoint: Vec3
): FaceGeoPositions | undefined {
    let minDistSq = Infinity
    let closest: FaceGeoPositions | undefined
    for (const face of faces) {
        const dx = queryPoint.x - face.center.x
        const dy = queryPoint.y - face.center.y
        const dz = queryPoint.z - face.center.z
        const distSq = dx * dx + dy * dy + dz * dz
        if (distSq < minDistSq) { minDistSq = distSq; closest = face }
    }
    return closest
}

// face.v must be populated (Subtriangles must have been computed for this face).
// queryDir is a unit-sphere direction vector.
export function findSubtriangle3D(face: FaceGeoPositions, queryDir: Vec3): number {
    const q    = new CartesianCoord(queryDir)
    const p_ab   = new CartesianCoord(face.v[3])
    const p_bc   = new CartesianCoord(face.v[4])
    const p_ac   = new CartesianCoord(face.v[5])
    const p_a_ab  = new CartesianCoord(face.v[6])
    const p_ab_b  = new CartesianCoord(face.v[11])
    const p_b_bc  = new CartesianCoord(face.v[9])
    const p_bc_c  = new CartesianCoord(face.v[14])
    const p_c_ac  = new CartesianCoord(face.v[12])
    const p_ac_a  = new CartesianCoord(face.v[8])
    const p_ab_bc = new CartesianCoord(face.v[10])
    const p_bc_ac = new CartesianCoord(face.v[13])
    const p_ac_ab = new CartesianCoord(face.v[7])

    let cp = cross_product(p_ab, p_bc)
    let dp = dot_product(cp, q)

    if (dp > 0) {
        cp = cross_product(p_ab_bc, p_ab_b); dp = dot_product(cp, q)
        if (dp > 0) { return 5 }
        cp = cross_product(p_ab_b, p_b_bc); dp = dot_product(cp, q)
        if (dp > 0) { return 6 }
        cp = cross_product(p_b_bc, p_ab_bc); dp = dot_product(cp, q)
        return dp > 0 ? 8 : 7
    }

    cp = cross_product(p_ac, p_ab); dp = dot_product(cp, q)
    if (dp > 0) {
        cp = cross_product(p_ac_a, p_a_ab); dp = dot_product(cp, q)
        if (dp > 0) { return 1 }
        cp = cross_product(p_a_ab, p_ac_ab); dp = dot_product(cp, q)
        if (dp > 0) { return 3 }
        cp = cross_product(p_ac_ab, p_ac_a); dp = dot_product(cp, q)
        return dp > 0 ? 15 : 2
    }

    cp = cross_product(p_bc, p_ac); dp = dot_product(cp, q)
    if (dp > 0) {
        cp = cross_product(p_c_ac, p_bc_ac); dp = dot_product(cp, q)
        if (dp > 0) { return 13 }
        cp = cross_product(p_bc_ac, p_bc_c); dp = dot_product(cp, q)
        if (dp > 0) { return 10 }
        cp = cross_product(p_bc_c, p_c_ac); dp = dot_product(cp, q)
        return dp > 0 ? 11 : 12
    }

    cp = cross_product(p_ac_ab, p_ab_bc); dp = dot_product(cp, q)
    if (dp > 0) { return 4 }
    cp = cross_product(p_ab_bc, p_bc_ac); dp = dot_product(cp, q)
    if (dp > 0) { return 9 }
    cp = cross_product(p_bc_ac, p_ac_ab); dp = dot_product(cp, q)
    return dp > 0 ? 14 : 0
}

// Project a surface point onto the 2D local coordinate system of a triangle.
// Returns (Xc, Yc) barycentric-like coordinates in [0, 1].
export function projectToTriangle(face: FaceGeoPositions, point: Vec3): { Xc: number; Yc: number } {
    const o = face.vertices[0]
    const b1 = new CartesianCoord(face.vertices[1].x - o.x, face.vertices[1].y - o.y, face.vertices[1].z - o.z)
    const b2 = new CartesianCoord(face.vertices[2].x - o.x, face.vertices[2].y - o.y, face.vertices[2].z - o.z)
    const pv = new CartesianCoord(point.x - o.x, point.y - o.y, point.z - o.z)
    const normal = cross_product(b1, b2)
    const normSq = dot_product(normal, normal)
    if (normSq === 0) return { Xc: 0, Yc: 0 }
    return {
        Xc: dot_product(cross_product(b1, pv), normal) / normSq,
        Yc: dot_product(cross_product(pv, b2), normal) / normSq,
    }
}

// Given coordinates (Xc, Yc) within a triangle, find which of the 16 sub-triangles
// contains the point. Returns the sub-triangle index and the scaled coordinates
// for the next recursion level (Xc * 4, Yc * 4 mapped into the sub-triangle).
export function findSubtriangle2D(Xc: number, Yc: number): { index: number; Xc: number; Yc: number } {
    let ETiD = 0
    if (Yc > 0.5) {
        if (Yc > 0.75)          { ETiD = 6;  Yc -= 0.75 }
        else if (Xc > 0.25)     { ETiD = 8;  Yc -= 0.5; Xc -= 0.25 }
        else if (Xc + Yc < 0.75){ ETiD = 5;  Yc -= 0.5 }
        else                    { ETiD = 7;  Yc = 0.75 - Yc; Xc = 0.25 - Xc }
    } else if (Xc > 0.5) {
        if (Xc > 0.75)          { ETiD = 11; Xc -= 0.75 }
        else if (Yc > 0.25)     { ETiD = 10; Xc -= 0.5; Yc -= 0.25 }
        else if (Yc + Xc < 0.75){ ETiD = 13; Xc -= 0.5 }
        else                    { ETiD = 12; Yc = 0.25 - Yc; Xc = 0.75 - Xc }
    } else if (Xc + Yc < 0.5) {
        if (Yc > 0.25)          { ETiD = 3;  Yc -= 0.25 }
        else if (Xc > 0.25)     { ETiD = 15; Xc -= 0.25 }
        else if (Xc + Yc < 0.25){ ETiD = 1 }
        else                    { ETiD = 2;  Xc = 0.5 - Xc; Yc = 0.5 - Yc }
    } else {
        if (Yc < 0.25)          { ETiD = 14; Yc = 0.25 - Yc; Xc = 0.5 - Xc }
        else if (Xc < 0.25)     { ETiD = 4;  Yc = 0.5 - Yc; Xc = 0.25 - Xc }
        else if (Xc + Yc > 0.75){ ETiD = 9;  Yc = 0.5 - Yc; Xc = 0.5 - Xc }
        else                    { ETiD = 0;  Xc -= 0.25; Yc -= 0.25 }
    }
    return { index: ETiD, Xc: Xc * 4, Yc: Yc * 4 }
}
