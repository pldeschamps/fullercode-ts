import * as Cesium from 'cesium'
import { GeoCoord } from './GeoCoord'
import { RADIUS } from './state'

export class GeoPoint {
    id: string
    geo: GeoCoord | null
    cart: Cesium.Cartesian3 | null

    constructor(
        id: string,
        lat: number | null = null,
        lon: number | null = null,
        x: number | null = null,
        y: number | null = null,
        z: number | null = null
    ) {
        this.id = id
        this.geo = lat !== null && lon !== null ? new GeoCoord(lat, lon) : null
        this.cart = x !== null && y !== null && z !== null ? new Cesium.Cartesian3(x, y, z) : null
    }

    computeXYZ(radius = RADIUS): void {
        if (this.geo) {
            const radLat = (this.geo.lat * Math.PI) / 180
            const radLon = (this.geo.lon * Math.PI) / 180
            this.cart = new Cesium.Cartesian3(
                radius * Math.cos(radLat) * Math.cos(radLon),
                radius * Math.cos(radLat) * Math.sin(radLon),
                radius * Math.sin(radLat)
            )
        }
    }

    computeLatLon(): void {
        if (this.cart) {
            const { x, y, z } = this.cart
            const radius = Math.sqrt(x * x + y * y + z * z)
            this.geo = new GeoCoord(
                (Math.asin(z / radius) * 180) / Math.PI,
                (Math.atan2(y, x) * 180) / Math.PI
            )
        }
    }
}
