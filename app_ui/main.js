const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { execSync } = require('child_process');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

let mainWindow;
let currentFiles = [];

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 650,
        height: 700,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#111',
        resizable: false
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// ─── Python Path Detection ────────────────────────────────────────────────────
function findPython() {
    const candidates = [
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3',
        '/usr/local/bin/python3.11',
        '/opt/homebrew/bin/python3.11',
    ];

    // Try dynamic lookup first (works in dev mode)
    try {
        const found = execSync('which python3', { env: process.env }).toString().trim();
        if (found && fs.existsSync(found)) return found;
    } catch (e) { /* fall through */ }

    // Try known locations
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    return 'python3'; // last resort
}

// ─── Output Directory ─────────────────────────────────────────────────────────
function getOutputDir() {
    // Always write to ~/Documents/RadioCompliance so it's accessible and writable
    const dir = path.join(os.homedir(), 'Documents', 'RadioCompliance', 'output');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

// ─── IPC: File dropped via drag-and-drop ──────────────────────────────────────
ipcMain.on('file-dropped', (event, filePaths) => {
    if (Array.isArray(filePaths)) {
        // Filter out empty/invalid paths (packaged macOS sandbox issue)
        currentFiles = filePaths.filter(p => p && p.length > 0 && fs.existsSync(p));
    } else if (filePaths && fs.existsSync(filePaths)) {
        currentFiles = [filePaths];
    } else {
        currentFiles = [];
    }

    if (currentFiles.length === 0) {
        // Drag-and-drop returned empty paths (sandboxed packaged app) — open dialog instead
        dialog.showOpenDialog(mainWindow, {
            title: 'Select Audio File',
            filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aiff', 'm4a'] }],
            properties: ['openFile', 'multiSelections']
        }).then(result => {
            if (!result.canceled && result.filePaths.length > 0) {
                currentFiles = result.filePaths;
                event.sender.send('status-update', "FILES READY");
                event.sender.send('file-count', currentFiles.length);
            }
        });
        return;
    }

    console.log("Files Ready:", currentFiles);
    event.sender.send('status-update', "FILES READY");
    event.sender.send('file-count', currentFiles.length);
});

// ─── IPC: Open file dialog (Browse button) ───────────────────────────────────
ipcMain.on('browse-files', (event) => {
    dialog.showOpenDialog(mainWindow, {
        title: 'Select Audio File(s)',
        filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aiff', 'm4a'] }],
        properties: ['openFile', 'multiSelections']
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            currentFiles = result.filePaths;
            event.sender.send('status-update', "FILES READY");
            event.sender.send('file-count', currentFiles.length);
        }
    });
});

// ─── IPC: Start Scan ─────────────────────────────────────────────────────────
ipcMain.on('start-scan', (event) => {
    if (!currentFiles || currentFiles.length === 0) {
        event.sender.send('status-update', "ERR: NO FILE LOADED");
        return;
    }

    event.sender.send('status-update', "LOADING TAPE...");

    const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, 'src')
        : path.join(__dirname, '../src');

    const pythonScript = path.join(scriptPath, 'main.py');
    const pythonPath = findPython();
    const outputDir = getOutputDir();

    console.log('Python:', pythonPath);
    console.log('Script:', pythonScript);
    console.log('Files:', currentFiles);
    console.log('Output dir:', outputDir);

    // Verify script exists before spawning
    if (!fs.existsSync(pythonScript)) {
        event.sender.send('status-update', "ERR: SCRIPT NOT FOUND");
        console.error('Script not found at:', pythonScript);
        return;
    }

    const args = [pythonScript, ...currentFiles];

    const pythonProcess = spawn(pythonPath, args, {
        cwd: scriptPath,
        env: {
            ...process.env,
            PYTHONPATH: scriptPath,
            RADIO_OUTPUT_DIR: outputDir,             // Pass output dir to Python
            PATH: (process.env.PATH || '') + ':/usr/local/bin:/opt/homebrew/bin:/usr/bin',
        }
    });

    let hasStarted = false;

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Python stdout:', output);

        const lines = output.split('\n');
        lines.forEach(line => {
            if (line.startsWith('PROGRESS:')) {
                hasStarted = true;
                const message = line.slice('PROGRESS:'.length).trim();
                const progressNum = parseInt(message);

                if (!isNaN(progressNum)) {
                    event.sender.send('progress-update', progressNum);
                } else if (message === 'COMPLETE') {
                    event.sender.send('progress-update', 100);
                    event.sender.send('status-update', "SCAN COMPLETE");
                    event.sender.send('vu-active', false);
                } else if (message.startsWith('FOUND')) {
                    event.sender.send('status-update', "ANALYZING...");
                    event.sender.send('vu-active', true);
                } else if (message.startsWith('ERR')) {
                    event.sender.send('status-update', message.substring(0, 20));
                    event.sender.send('vu-active', false);
                } else if (message.startsWith('RECV')) {
                    console.log('Python received file:', message);
                    event.sender.send('status-update', "INITIALIZING...");
                }
            }
        });
    });

    pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error('Python stderr:', errorOutput);

        if (errorOutput.toLowerCase().includes('modulenotfounderror') ||
            errorOutput.toLowerCase().includes('importerror')) {
            event.sender.send('status-update', "ERR: MISSING DEPS");
            event.sender.send('vu-active', false);
        } else if (errorOutput.toLowerCase().includes('error') ||
                   errorOutput.toLowerCase().includes('exception')) {
            event.sender.send('status-update', "ERR: PROCESS FAILED");
            event.sender.send('vu-active', false);
        }
    });

    pythonProcess.on('close', (code) => {
        console.log('Python exited:', code);
        if (code === 0 && hasStarted) {
            event.sender.send('progress-update', 100);
            event.sender.send('status-update', "SCAN COMPLETE");
        } else if (!hasStarted) {
            event.sender.send('status-update', "ERR: FAILED TO START");
        } else if (code !== 0) {
            event.sender.send('status-update', "ERR: PROCESS CRASHED");
        }
        event.sender.send('vu-active', false);
    });

    pythonProcess.on('error', (err) => {
        console.error('Spawn error:', err);
        event.sender.send('status-update', "ERR: PYTHON NOT FOUND");
        event.sender.send('vu-active', false);
    });
});

// ─── IPC: Open Output Folder ─────────────────────────────────────────────────
ipcMain.on('open-output', (event) => {
    const outputDir = getOutputDir();
    shell.openPath(outputDir).then((err) => {
        if (err) console.error("Error opening output:", err);
    });
});
