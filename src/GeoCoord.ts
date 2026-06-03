export class GeoCoord {
    lat: number
    lon: number

    constructor(lat: number, lon: number) {
        this.lat = lat
        this.lon = lon
    }

    toString(): string {
        return `${this.lat}, ${this.lon}`
    }

    static distance(coord1: GeoCoord, coord2: GeoCoord): number {
        const toRad = (value: number) => (value * Math.PI) / 180
        const R = 6371
        const dLat = toRad(coord2.lat - coord1.lat)
        const dLon = toRad(coord2.lon - coord1.lon)
        const lat1 = toRad(coord1.lat)
        const lat2 = toRad(coord2.lat)
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
    }
}
