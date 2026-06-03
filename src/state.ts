import type * as Cesium from 'cesium'
import type { FaceGeoPositions } from './FaceGeoPositions'

export const RADIUS = 6371010.0
export const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export interface FullerData {
    facesGeoPositions?: FaceGeoPositions[]
    facesPositions?: Cesium.Cartesian3[][]
    viewer?: Cesium.Viewer
}

export const fullerData: FullerData = {}
export const triangles: FaceGeoPositions[] = []
export let LevelHeights: number[] = []

let _viewer: Cesium.Viewer | undefined

export function setViewer(v: Cesium.Viewer): void {
    _viewer = v
    fullerData.viewer = v
}

export function getViewer(): Cesium.Viewer {
    if (!_viewer) throw new Error('Viewer not initialized')
    return _viewer
}
