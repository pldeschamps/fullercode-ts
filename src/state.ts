import type { FaceGeoPositions } from './FaceGeoPositions'
import type { Vec3 } from './Vec3'

export const RADIUS = 6371010.0
export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export interface FullerData {
    facesGeoPositions?: FaceGeoPositions[]
    facesPositions?: Vec3[][]
}

export const fullerData: FullerData = {}
export const triangles: FaceGeoPositions[] = []
