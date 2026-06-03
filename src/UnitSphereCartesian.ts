import type * as Cesium from 'cesium'

export class UnitSphereCartesian {
    x: number
    y: number
    z: number

    constructor(cesiumCartographic: Cesium.Cartographic) {
        const latRad = cesiumCartographic.latitude
        const lonRad = cesiumCartographic.longitude
        const cosLat = Math.cos(latRad)
        this.x = cosLat * Math.cos(lonRad)
        this.y = cosLat * Math.sin(lonRad)
        this.z = Math.sin(latRad)
    }
}
