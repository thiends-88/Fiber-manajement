// PM2 config untuk FiberOps di Proxmox
// Jalankan: pm2 start ecosystem.config.cjs
// Restart: pm2 restart fiberops
module.exports = {
  apps: [
    {
      name: "fiberops",
      cwd: "/opt/fiberops",
      script: ".output/server/index.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        HOST: "0.0.0.0",
      },
      max_memory_restart: "512M",
      error_file: "/var/log/fiberops/error.log",
      out_file: "/var/log/fiberops/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
