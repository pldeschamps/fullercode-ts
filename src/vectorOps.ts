import * as Cesium from 'cesium'
import { CartesianCoord } from './CartesianCoord'
import { RADIUS } from './state'

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

export function midpoint(p1: Cesium.Cartesian3, p2: Cesium.Cartesian3, radius = RADIUS): Cesium.Cartesian3 {
    const x = p1.x + p2.x
    const y = p1.y + p2.y
    const z = p1.z + p2.z
    const length = Math.sqrt(x * x + y * y + z * z)
    return new Cesium.Cartesian3((x / length) * radius, (y / length) * radius, (z / length) * radius)
}
