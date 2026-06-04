export class UnitSphereCartesian {
    x: number
    y: number
    z: number

    constructor(carto: { latitude: number; longitude: number }) {
        const cosLat = Math.cos(carto.latitude)
        this.x = cosLat * Math.cos(carto.longitude)
        this.y = cosLat * Math.sin(carto.longitude)
        this.z = Math.sin(carto.latitude)
    }
}
