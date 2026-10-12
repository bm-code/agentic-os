// Selector de carpetas nativo del sistema. Un navegador no puede dar rutas absolutas por seguridad,
// pero el servidor corre en el propio equipo y sí puede abrir el diálogo del SO.
import { spawn } from 'node:child_process';

const PROMPT = 'Selecciona la carpeta del proyecto';

const MAC = ['osascript', ['-e', 'tell application "System Events"', '-e', 'activate', '-e', `POSIX path of (choose folder with prompt "${PROMPT}")`, '-e', 'end tell']];

// PowerShell: ventana propietaria TopMost para que el diálogo no quede detrás del navegador.
const WIN_SCRIPT = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = "CenterScreen" }',
  '$o.Show()',
  `$f = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{ Description = "${PROMPT}"; ShowNewFolderButton = $false }`,
  'if ($f.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }',
  '$o.Close()',
].join('; ');
const WIN = ['powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WIN_SCRIPT]];

const LINUX = [
  ['zenity', ['--file-selection', '--directory', `--title=${PROMPT}`]],
  ['kdialog', ['--getexistingdirectory', process.env.HOME || '/', '--title', PROMPT]],
];

export function candidates(platform = process.platform) {
  if (platform === 'darwin') return [MAC];
  if (platform === 'win32') return [WIN];
  return LINUX;
}

/** Quita saltos de línea y la barra final, salvo en la raíz ("/" o "C:\\"). */
export function cleanPath(out) {
  const p = String(out || '').replace(/[\r\n]+$/g, '').trim();
  if (p === '/' || /^[A-Za-z]:[\\/]?$/.test(p)) return p;
  return p.replace(/[\\/]+$/, '');
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: false });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ missing: e.code === 'ENOENT', error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

let busy = false;

/** Devuelve la ruta elegida, o null si el usuario cancela. Lanza si no hay selector disponible. */
export async function pickFolder({ platform = process.platform, timeout = 5 * 60 * 1000 } = {}) {
  if (busy) throw Object.assign(new Error('Ya hay un selector de carpetas abierto'), { status: 409 });
  busy = true;
  try {
    for (const [cmd, args] of candidates(platform)) {
      const r = await run(cmd, args, timeout);
      if (r.missing) continue;
      if (r.error) throw Object.assign(new Error(r.error), { status: 501 });
      const picked = cleanPath(r.out);
      return r.code === 0 && picked ? picked : null; // código ≠ 0 o vacío = cancelado
    }
    throw Object.assign(new Error('No se pudo abrir el selector de carpetas en este sistema: escribe la ruta a mano.'), { status: 501 });
  } finally {
    busy = false;
  }
}
