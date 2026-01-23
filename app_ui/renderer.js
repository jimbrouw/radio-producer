const { ipcRenderer } = require('electron');

const dropZone = document.getElementById('drop-zone');
const statusText = document.getElementById('status-text');
const trackInfo = document.getElementById('track-info');
const needleL = document.getElementById('needle-l');
const needleR = document.getElementById('needle-r');
const scanBtn = document.getElementById('btn-scan');
const resetBtn = document.getElementById('btn-reset');

// Drag & Drop Handling
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');

    if (e.dataTransfer.files.length > 0) {
        // Collect all file paths
        const filePaths = Array.from(e.dataTransfer.files).map(f => f.path);
        console.log("Files:", filePaths);

        // Update label
        if (filePaths.length === 1) {
            document.querySelector('.tape-label').innerText = "AUDIO LOADED";
        } else {
            document.querySelector('.tape-label').innerText = `TAPES LOADED: ${filePaths.length}`;
        }

        statusText.innerText = "FILES READY";
        trackInfo.innerText = "PRESS ANALYZE TO START";

        // Notify Main
        ipcRenderer.send('file-dropped', filePaths);
    }
});

// Reset / Open Output Button
resetBtn.addEventListener('click', () => {
    if (resetBtn.innerText === "OPEN REPORT") {
        ipcRenderer.send('open-output');
    } else {
        // Normal Reset
        statusText.innerText = "SYSTEM READY";
        trackInfo.innerText = "DROP AUDIO FILE HERE";
        document.querySelector('.tape-label').innerText = "NO FILE";
        scanBtn.classList.remove('active');
    }
});

// Scan Button
scanBtn.addEventListener('click', () => {
    scanBtn.classList.toggle('active');
    statusText.innerText = "INITIALIZING...";
    ipcRenderer.send('start-scan');
});

// IPC Listeners
ipcRenderer.on('status-update', (event, message) => {
    statusText.innerText = message;

    // Auto-update subtext based on main status
    if (message.includes("COMPLETE")) {
        trackInfo.innerText = "CHECK OUTPUT FOLDER";
        resetBtn.innerText = "OPEN REPORT"; // Change button function
    }
});

ipcRenderer.on('progress-update', (event, percent) => {
    // ASCII Progress Bar
    const totalBlocks = 16;
    const filledBlocks = Math.round((percent / 100) * totalBlocks);
    const emptyBlocks = totalBlocks - filledBlocks;

    const bar = "█".repeat(filledBlocks) + "▒".repeat(emptyBlocks);
    trackInfo.innerText = `${bar} ${percent}%`;
});
ipcRenderer.on('vu-active', (event, isActive) => {
    // No fake animation desired.
    // Maybe set needles to a specific position to show 'Active'?
    if (isActive) {
        needleL.style.transform = `rotate(-10deg)`;
        needleR.style.transform = `rotate(-10deg)`;
    } else {
        needleL.style.transform = `rotate(-45deg)`;
        needleR.style.transform = `rotate(-45deg)`;
    }
});

