import { CartesianCoord } from './CartesianCoord'
import { RADIUS } from './state'
import type { Vec3 } from './Vec3'

export function dot_product(a: CartesianCoord, b: CartesianCoord): number {
    return a.x * b.x + a.y * b.y + a.z * b.z
}

export function cross_product(a: CartesianCoord, b: CartesianCoord): CartesianCoord {
    return new CartesianCoord(
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x
    )
}


