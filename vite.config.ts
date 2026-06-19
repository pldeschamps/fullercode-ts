import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const cesiumSource = 'node_modules/cesium/Build/Cesium'
const cesiumBaseUrl = 'cesium'

export default defineConfig({
  base: './',
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
        { src: 'icosahedron.json', dest: '.' },
        { src: 'base.css', dest: '.' },
        { src: 'styles.css', dest: '.' },
        { src: 'underthehood.html', dest: '.' },
        { src: 'share.svg', dest: '.' },
        { src: 'telstar.svg', dest: '.' },
      ],
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          cesium: ['cesium'],
        },
      },
    },
  },
})
