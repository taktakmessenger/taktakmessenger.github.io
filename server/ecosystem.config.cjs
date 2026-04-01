module.exports = {
  apps : [{
    name: "taktak-vps",
    script: "dist/index.js",
    cwd: ".",
    watch: false,
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}
