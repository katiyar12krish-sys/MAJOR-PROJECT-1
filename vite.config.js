import { resolve } from 'path';
import { defineConfig } from 'vite';
import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';

function piBackendPlugin() {
  return {
    name: 'pi-backend-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url, 'http://localhost:5173');

        // 1. Test real TCP connectivity to Raspberry Pi (Port 22 SSH or 8765 WebSocket)
        if (url.pathname === '/api/pi/test-connection') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const port = parseInt(url.searchParams.get('port') || '22', 10);

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP address provided' }));
          }

          const start = Date.now();
          const socket = new net.Socket();
          let responded = false;

          const finish = (success, error = null) => {
            if (responded) return;
            responded = true;
            socket.destroy();
            const latency = Date.now() - start;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success,
              ip,
              port,
              latency,
              error
            }));
          };

          socket.setTimeout(3500);
          socket.connect(port, ip, () => {
            finish(true);
          });

          socket.on('error', (err) => {
            finish(false, err.message);
          });

          socket.on('timeout', () => {
            finish(false, 'Connection timed out (3.5s). Host unreachable or port closed.');
          });

          return;
        }

        // Helper to execute SSH commands non-interactively
        function runSsh(user, ip, port, cmd, timeoutMs = 7000) {
          return new Promise((resolve) => {
            const sshProcess = spawn('ssh', [
              '-o', 'BatchMode=yes',
              '-o', 'StrictHostKeyChecking=no',
              '-o', 'ConnectTimeout=4',
              '-p', String(port || 22),
              `${user}@${ip}`,
              cmd
            ]);

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timer = setTimeout(() => {
              timedOut = true;
              try { sshProcess.kill(); } catch (_) {}
              resolve({ success: false, error: 'Command timed out (7s). Pi slow or unreachable.', stdout, stderr });
            }, timeoutMs);

            sshProcess.stdout.on('data', d => { stdout += d.toString(); });
            sshProcess.stderr.on('data', d => { stderr += d.toString(); });

            sshProcess.on('close', code => {
              if (timedOut) return;
              clearTimeout(timer);
              const isSuccess = code === 0;
              const needKey = (stderr && (stderr.includes('Permission denied') || stderr.includes('publickey')));
              resolve({
                success: isSuccess,
                code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                needKey,
                error: isSuccess ? null : (needKey ? 'Password required: Run "Open PowerShell SSH" to login or configure ssh-copy-id.' : (stderr || `Exited with code ${code}`))
              });
            });

            sshProcess.on('error', err => {
              if (timedOut) return;
              clearTimeout(timer);
              resolve({ success: false, error: err.message, stdout, stderr });
            });
          });
        }

        // 2. Launch native PowerShell SSH session directly on user's entered IP & User
        if (url.pathname === '/api/pi/launch-ssh') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = (url.searchParams.get('port') || '22').trim();

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP provided' }));
          }

          try {
            fs.writeFileSync(resolve(__dirname, '.pi_ip'), ip, 'utf8');
            fs.writeFileSync(resolve(__dirname, '.pi_user'), user, 'utf8');

            const batPath = resolve(__dirname, 'CONNECT_PI_POWERSHELL.bat');
            spawn('cmd.exe', ['/c', 'start', batPath, ip, user], {
              cwd: resolve(__dirname),
              detached: true,
              stdio: 'ignore'
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              success: true,
              message: `PowerShell SSH launched for ${user}@${ip}:${port} into ~/intramove`
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: err.message }));
          }
        }

        // 3. Save IP and User on disk
        if (url.pathname === '/api/pi/save-ip') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body || '{}');
              if (data.ip) {
                fs.writeFileSync(resolve(__dirname, '.pi_ip'), data.ip.trim(), 'utf8');
              }
              if (data.user) {
                fs.writeFileSync(resolve(__dirname, '.pi_user'), data.user.trim(), 'utf8');
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: true, ip: data.ip, user: data.user }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 4. Retrieve saved IP & User from disk
        if (url.pathname === '/api/pi/get-ip') {
          try {
            const ipFile = resolve(__dirname, '.pi_ip');
            const userFile = resolve(__dirname, '.pi_user');
            let savedIp = '';
            let savedUser = 'major';
            if (fs.existsSync(ipFile)) {
              savedIp = fs.readFileSync(ipFile, 'utf8').trim();
            }
            if (fs.existsSync(userFile)) {
              savedUser = fs.readFileSync(userFile, 'utf8').trim() || 'major';
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ip: savedIp, user: savedUser }));
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ip: '', user: 'major' }));
          }
          return;
        }

        // 5. Execute Command on Raspberry Pi via SSH
        if (url.pathname === '/api/pi/exec') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const ip = (data.ip || '').trim();
              const user = (data.user || 'major').trim();
              const port = data.port || 22;
              const cmd = data.cmd || 'ls -la';

              if (!ip) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'No IP specified' }));
              }

              const result = await runSsh(user, ip, port, cmd);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 6. List remote files in ~/intramove (/home/<user>/intramove)
        if (url.pathname === '/api/pi/list-remote-files') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = url.searchParams.get('port') || 22;
          const targetDir = url.searchParams.get('dir') || '~/intramove';

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP provided' }));
          }

          // Use python script or fallback ls to safely get file names and sizes
          const remoteScript = `python3 -c "import os, json; p = os.path.expanduser('${targetDir}'); os.makedirs(p, exist_ok=True); items = [{'name': f, 'size': os.path.getsize(os.path.join(p, f)), 'isDir': os.path.isdir(os.path.join(p, f))} for f in sorted(os.listdir(p)) if not f.startswith('.')]; print(json.dumps(items))" 2>/dev/null || ls -1 -p ${targetDir} 2>/dev/null`;

          runSsh(user, ip, port, remoteScript).then(result => {
            if (result.success) {
              let files = [];
              try {
                // Try JSON output from Python
                files = JSON.parse(result.stdout);
              } catch (_) {
                // Fallback parsing ls
                const lines = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
                files = lines.map(line => ({
                  name: line.replace(/\/$/, ''),
                  size: 0,
                  isDir: line.endsWith('/')
                }));
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                user,
                ip,
                dir: targetDir,
                files
              }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            }
          });
          return;
        }

        // 7. Read remote file content from ~/intramove
        if (url.pathname === '/api/pi/read-remote-file') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = url.searchParams.get('port') || 22;
          const filename = (url.searchParams.get('file') || '').trim();

          if (!ip || !filename) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Missing IP or filename' }));
          }

          // Read file content
          const cmd = `cat ~/intramove/${filename} 2>/dev/null || cat /home/${user}/intramove/${filename}`;
          runSsh(user, ip, port, cmd, 8000).then(result => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: result.success,
              filename,
              content: result.stdout,
              error: result.error
            }));
          });
          return;
        }

        // 8. Write / Save file to ~/intramove on Pi
        if (url.pathname === '/api/pi/write-remote-file') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const ip = (data.ip || '').trim();
              const user = (data.user || 'major').trim();
              const port = data.port || 22;
              const filename = (data.filename || '').trim();
              const content = data.content || '';

              if (!ip || !filename) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Missing IP or filename' }));
              }

              // Base64 encode content to prevent shell quoting breakage
              const b64 = Buffer.from(content, 'utf8').toString('base64');
              const cmd = `mkdir -p ~/intramove && echo "${b64}" | base64 -d > ~/intramove/${filename}`;

              const result = await runSsh(user, ip, port, cmd, 9000);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: result.success,
                filename,
                size: Buffer.byteLength(content, 'utf8'),
                error: result.error
              }));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 9. Inspect Python Libraries on Raspberry Pi (pip list)
        if (url.pathname === '/api/pi/list-libraries') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = url.searchParams.get('port') || 22;

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP provided' }));
          }

          // Query installed libraries via python / pip
          const cmd = `python3 -m pip list --format=json 2>/dev/null || python3 -c "import pkg_resources, json; print(json.dumps([{'name': d.project_name, 'version': d.version} for d in sorted(pkg_resources.working_set, key=lambda x: x.project_name.lower())]))" 2>/dev/null || pip list`;

          runSsh(user, ip, port, cmd, 10000).then(result => {
            if (result.success) {
              let libraries = [];
              try {
                libraries = JSON.parse(result.stdout);
              } catch (_) {
                // Fallback text parser
                const lines = result.stdout.split('\n').slice(2);
                libraries = lines.map(line => {
                  const parts = line.trim().split(/\s+/);
                  return parts[0] ? { name: parts[0], version: parts[1] || '' } : null;
                }).filter(Boolean);
              }

              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                user,
                ip,
                count: libraries.length,
                libraries
              }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [piBackendPlugin()],
  server: {
    port: 5173,
    open: false,
    host: true
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        slam: resolve(__dirname, 'slam-mapping.html')
      }
    }
  }
});
