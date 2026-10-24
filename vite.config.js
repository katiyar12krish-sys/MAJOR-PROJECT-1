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

        // Helper to get saved password if available
        function getSavedPassword() {
          try {
            const passFile = resolve(__dirname, '.pi_pass');
            if (fs.existsSync(passFile)) {
              return fs.readFileSync(passFile, 'utf8').trim();
            }
          } catch (_) {}
          return '';
        }

        // Helper to execute SSH commands non-interactively, with or without password
        function runSsh(user, ip, port, cmd, timeoutMs = 15000, password = '') {
          return new Promise((resolvePromise) => {
            const effectivePass = password || getSavedPassword();
            const askpassBatPath = resolve(__dirname, '.askpass.bat');

            if (!fs.existsSync(askpassBatPath)) {
              fs.writeFileSync(askpassBatPath, '@echo off\r\necho %INTRAMOVE_SSH_PASS%\r\n', 'utf8');
            }

            const sshArgs = [
              '-o', 'StrictHostKeyChecking=no',
              '-o', 'UserKnownHostsFile=NUL',
              '-o', 'LogLevel=ERROR',
              '-o', 'ConnectTimeout=6',
              '-p', String(port || 22),
              `${user}@${ip}`,
              cmd
            ];

            const env = { ...process.env };
            if (effectivePass) {
              env.DISPLAY = '1';
              env.SSH_ASKPASS = askpassBatPath;
              env.SSH_ASKPASS_REQUIRE = 'force';
              env.INTRAMOVE_SSH_PASS = effectivePass;
            } else {
              sshArgs.unshift('-o', 'BatchMode=yes');
            }

            const sshProcess = spawn('ssh', sshArgs, { env });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            const timer = setTimeout(() => {
              timedOut = true;
              try { sshProcess.kill(); } catch (_) {}
              resolvePromise({ success: false, error: 'Command timed out (15s). Pi slow or unreachable.', stdout, stderr });
            }, timeoutMs);

            sshProcess.stdout.on('data', d => { stdout += d.toString(); });
            sshProcess.stderr.on('data', d => { stderr += d.toString(); });

            sshProcess.on('close', code => {
              if (timedOut) return;
              clearTimeout(timer);
              const isSuccess = code === 0;
              const needKey = (stderr && (stderr.includes('Permission denied') || stderr.includes('publickey') || stderr.includes('password')));
              let errorMsg = null;
              if (!isSuccess) {
                if (needKey) {
                  errorMsg = effectivePass
                    ? `Authentication failed: Incorrect password for ${user}@${ip}.`
                    : `Password required: Please enter your Raspberry Pi password in the "Pass:" field above and try again.`;
                } else {
                  errorMsg = stderr || `Exited with code ${code}`;
                }
              }

              resolvePromise({
                success: isSuccess,
                code,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                needKey,
                error: errorMsg
              });
            });

            sshProcess.on('error', err => {
              if (timedOut) return;
              clearTimeout(timer);
              resolvePromise({ success: false, error: err.message, stdout, stderr });
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

        // 3. Save IP, User, and Password on disk
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
              if (typeof data.password === 'string') {
                const passFile = resolve(__dirname, '.pi_pass');
                if (data.password.trim()) {
                  fs.writeFileSync(passFile, data.password.trim(), 'utf8');
                } else if (fs.existsSync(passFile)) {
                  fs.unlinkSync(passFile);
                }
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

        // 4. Retrieve saved IP, User & Password from disk
        if (url.pathname === '/api/pi/get-ip') {
          try {
            const ipFile = resolve(__dirname, '.pi_ip');
            const userFile = resolve(__dirname, '.pi_user');
            const passFile = resolve(__dirname, '.pi_pass');
            let savedIp = '';
            let savedUser = 'major';
            let savedPass = '';
            if (fs.existsSync(ipFile)) {
              savedIp = fs.readFileSync(ipFile, 'utf8').trim();
            }
            if (fs.existsSync(userFile)) {
              savedUser = fs.readFileSync(userFile, 'utf8').trim() || 'major';
            }
            if (fs.existsSync(passFile)) {
              savedPass = fs.readFileSync(passFile, 'utf8').trim();
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ip: savedIp, user: savedUser, password: savedPass }));
          } catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ip: '', user: 'major', password: '' }));
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
              const password = (data.password || '').trim();
              const timeout = data.timeoutMs || (cmd.includes('pip') || cmd.includes('apt') ? 120000 : 30000);

              if (!ip) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'No IP specified' }));
              }

              const result = await runSsh(user, ip, port, cmd, timeout, password);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 6. List remote files in ~/intra_move (or ~/intramove)
        if (url.pathname === '/api/pi/list-remote-files') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = url.searchParams.get('port') || 22;
          const targetDir = (url.searchParams.get('dir') || '~/intra_move').trim();
          const password = (url.searchParams.get('pass') || '').trim();

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP provided' }));
          }

          const remoteScript = `python3 -c "import os, json; candidates = ['${targetDir}', '~/intra_move', '~/intramove', '/home/${user}/intra_move']; p = next((os.path.expanduser(c) for c in candidates if os.path.exists(os.path.expanduser(c))), os.path.expanduser('${targetDir}')); os.makedirs(p, exist_ok=True); items = [{'name': f, 'size': os.path.getsize(os.path.join(p, f)), 'isDir': os.path.isdir(os.path.join(p, f))} for f in sorted(os.listdir(p)) if not f.startswith('.')]; print(json.dumps({'dir': p, 'files': items}))" 2>/dev/null || ls -1 -p ${targetDir} 2>/dev/null`;

          runSsh(user, ip, port, remoteScript, 12000, password).then(result => {
            if (result.success) {
              let files = [];
              let resolvedDir = targetDir;
              try {
                const parsed = JSON.parse(result.stdout);
                if (parsed.files) {
                  files = parsed.files;
                  resolvedDir = parsed.dir || targetDir;
                } else if (Array.isArray(parsed)) {
                  files = parsed;
                }
              } catch (_) {
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
                dir: resolvedDir,
                files
              }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            }
          });
          return;
        }

        // 7. Read remote file content from ~/intra_move / ~/intramove
        if (url.pathname === '/api/pi/read-remote-file') {
          const ip = (url.searchParams.get('ip') || '').trim();
          const user = (url.searchParams.get('user') || 'major').trim();
          const port = url.searchParams.get('port') || 22;
          const filename = (url.searchParams.get('file') || '').trim();
          const targetDir = (url.searchParams.get('dir') || '~/intra_move').trim();
          const password = (url.searchParams.get('pass') || '').trim();

          if (!ip || !filename) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'Missing IP or filename' }));
          }

          const cmd = `cat ${targetDir}/${filename} 2>/dev/null || cat ~/intra_move/${filename} 2>/dev/null || cat ~/intramove/${filename} 2>/dev/null || cat /home/${user}/intra_move/${filename}`;
          runSsh(user, ip, port, cmd, 8000, password).then(result => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              success: result.success,
              filename,
              dir: targetDir,
              content: result.stdout,
              error: result.error
            }));
          });
          return;
        }

        // 8. Write / Save file to ~/intra_move on Pi
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
              const targetDir = (data.dir || '~/intra_move').trim();
              const content = data.content || '';
              const password = (data.password || '').trim();

              if (!ip || !filename) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Missing IP or filename' }));
              }

              const b64 = Buffer.from(content, 'utf8').toString('base64');
              const cmd = `mkdir -p ${targetDir} && echo "${b64}" | base64 -d > ${targetDir}/${filename}`;

              const result = await runSsh(user, ip, port, cmd, 10000, password);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: result.success,
                filename,
                dir: targetDir,
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
          const password = (url.searchParams.get('pass') || '').trim();

          if (!ip) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: false, error: 'No IP provided' }));
          }

          // Query installed libraries via python / pip
          const cmd = `python3 -m pip list --format=json 2>/dev/null || python3 -c "import pkg_resources, json; print(json.dumps([{'name': d.project_name, 'version': d.version} for d in sorted(pkg_resources.working_set, key=lambda x: x.project_name.lower())]))" 2>/dev/null || pip list`;

          runSsh(user, ip, port, cmd, 15000, password).then(result => {
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

        // 10. Install Python Library on Raspberry Pi
        if (url.pathname === '/api/pi/install-library') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const ip = (data.ip || '').trim();
              const user = (data.user || 'major').trim();
              const port = data.port || 22;
              const pkg = (data.pkg || '').trim();
              const password = (data.password || '').trim();

              if (!ip || !pkg) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Missing IP or package name' }));
              }

              // Sanitize package name (allow alphanumeric, dash, underscore, dot, version specifiers)
              const cleanPkg = pkg.replace(/[^a-zA-Z0-9_\-\.\=\<\>\~\@\[\]\,]/g, '');
              const cmd = `python3 -m pip install "${cleanPkg}" --break-system-packages 2>&1 || pip3 install "${cleanPkg}" 2>&1 || pip install "${cleanPkg}"`;

              const result = await runSsh(user, ip, port, cmd, 150000, password);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
          return;
        }

        // 11. Uninstall Python Library on Raspberry Pi
        if (url.pathname === '/api/pi/uninstall-library') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const ip = (data.ip || '').trim();
              const user = (data.user || 'major').trim();
              const port = data.port || 22;
              const pkg = (data.pkg || '').trim();
              const password = (data.password || '').trim();

              if (!ip || !pkg) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: false, error: 'Missing IP or package name' }));
              }

              const cleanPkg = pkg.replace(/[^a-zA-Z0-9_\-\.]/g, '');
              const cmd = `python3 -m pip uninstall -y "${cleanPkg}" --break-system-packages 2>&1 || pip3 uninstall -y "${cleanPkg}" 2>&1 || pip uninstall -y "${cleanPkg}"`;

              const result = await runSsh(user, ip, port, cmd, 60000, password);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: err.message }));
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
