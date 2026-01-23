const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { PythonShell } = require('python-shell');
const { spawn } = require('child_process');

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


// IPC: Receive file path (Just Store It)
ipcMain.on('file-dropped', (event, filePaths) => {
    // Determine if it was a single path (legacy/one file) or array
    if (Array.isArray(filePaths)) {
        currentFiles = filePaths;
    } else {
        currentFiles = [filePaths];
    }

    console.log("Files Ready:", currentFiles);
    event.sender.send('status-update', "FILES READY");
});

// Helper function to find Python
function findPython() {
    // Try multiple common Python locations
    const pythonPaths = [
        '/usr/local/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/bin/python3',
        'python3',
        'python'
    ];

    // For now, return the first one (we'll check it exists when spawning)
    return pythonPaths[0];
}

// IPC: Start Scan (Triggered by Button)
ipcMain.on('start-scan', (event) => {
    if (!currentFiles || currentFiles.length === 0) {
        event.sender.send('status-update', "ERR: NO FILE LOADED");
        return;
    }

    // Send acknowledgement back to UI
    event.sender.send('status-update', "LOADING TAPE...");

    // Determine script path based on if we are running from source or packaged app
    const scriptPath = app.isPackaged
        ? path.join(process.resourcesPath, 'src')
        : path.join(__dirname, '../src');

    const pythonScript = path.join(scriptPath, 'main.py');
    console.log('Script path:', scriptPath);
    console.log('Python script:', pythonScript);
    console.log('Files to process:', currentFiles);

    // Use spawn instead of PythonShell for better error handling
    const pythonPath = findPython();

    // Construct args: [script, file1, file2, ...]
    const args = [pythonScript, ...currentFiles];

    const pythonProcess = spawn(pythonPath, args, {
        cwd: scriptPath,
        env: {
            ...process.env,
            PYTHONPATH: scriptPath,
            // Make sure Python can find dependencies
            PATH: process.env.PATH + ':/usr/local/bin:/opt/homebrew/bin'
        }
    });

    let hasStarted = false;

    pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        console.log('Python stdout:', output);

        // Parse progress messages
        const lines = output.split('\n');
        lines.forEach(line => {
            if (line.startsWith('PROGRESS:')) {
                hasStarted = true;
                const parts = line.split(':');
                if (parts.length >= 2) {
                    const message = parts[1].trim();

                    // Check if it's a numeric progress
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
                        event.sender.send('status-update', message);
                        event.sender.send('vu-active', false);
                    } else if (message.startsWith('RECV')) {
                        console.log('Python received file:', message);
                        event.sender.send('status-update', "INITIALIZING...");
                    }
                }
            }
        });
    });

    pythonProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.error('Python stderr:', errorOutput);

        // Only show critical errors to user
        if (errorOutput.toLowerCase().includes('error') ||
            errorOutput.toLowerCase().includes('exception')) {
            event.sender.send('status-update', "ERR: PROCESSING FAILED");
            event.sender.send('vu-active', false);
        }
    });

    pythonProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);

        if (code === 0 && hasStarted) {
            // Success
            event.sender.send('progress-update', 100);
            event.sender.send('status-update', "SCAN COMPLETE");
        } else if (!hasStarted) {
            // Failed to start
            event.sender.send('status-update', "ERR: FAILED TO START");
        } else if (code !== 0) {
            // Crashed
            event.sender.send('status-update', "ERR: PROCESS CRASHED");
        }

        event.sender.send('vu-active', false);
    });

    pythonProcess.on('error', (err) => {
        console.error('Failed to start Python process:', err);
        event.sender.send('status-update', "ERR: PYTHON NOT FOUND");
        event.sender.send('vu-active', false);
    });

    // Initial UI feedback
    setTimeout(() => {
        if (!hasStarted) {
            console.warn('Python process taking longer than expected to start...');
        }
    }, 3000);
});

// IPC: Open Output Folder
ipcMain.on('open-output', (event) => {
    // We assume standard project structure: [Project]/output
    const outputPath = app.isPackaged
        ? path.join(process.resourcesPath, '../output')
        : path.join(__dirname, '../output');

    shell.openPath(outputPath).then((err) => {
        if (err) console.error("Error opening output:", err);
    });
});
