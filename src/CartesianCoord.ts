interface CartesianLike {
    x: number
    y: number
    z: number
}

export class CartesianCoord {
    x: number
    y: number
    z: number

    constructor(xOrObj: number | CartesianLike, y?: number, z?: number) {
        if (typeof xOrObj === 'object') {
            const len = Math.sqrt(xOrObj.x ** 2 + xOrObj.y ** 2 + xOrObj.z ** 2)
            this.x = xOrObj.x / len
            this.y = xOrObj.y / len
            this.z = xOrObj.z / len
        } else {
            const len = Math.sqrt(xOrObj ** 2 + y! ** 2 + z! ** 2)
            this.x = xOrObj / len
            this.y = y! / len
            this.z = z! / len
        }
    }

    static cross_product(a: CartesianCoord, b: CartesianCoord): CartesianCoord {
        return new CartesianCoord(
            a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x
        )
    }

    static dot_product(a: CartesianCoord, b: CartesianCoord): number {
        return a.x * b.x + a.y * b.y + a.z * b.z
    }
}
