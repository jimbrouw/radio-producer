import os
import sys
import logging
import datetime
from pathlib import Path
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn

try:
    from . import config, fingerprint, report, enrichment
except ImportError:
    # Fallback for direct execution
    import config
    import fingerprint
    import report
    import enrichment

console = Console()

def main():
    config.setup_logging()
    console.print("[bold blue]Radio Compliance Automation Tool - Phase 1[/bold blue]")
    
    # 1. Validation
    if not config.INPUT_DIR.exists():
        console.print(f"[red]Error: Input directory {config.INPUT_DIR} does not exist.[/red]")
        return
        
    if not config.OUTPUT_DIR.exists():
        config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    # 2. File Ingestion
    if len(sys.argv) > 1:
        # CLI Arguments provided (Single or Multi file mode for Electron App)
        # sys.argv[0] is script, sys.argv[1:] are files
        raw_args = sys.argv[1:]
        files = []
        
        for raw_arg in raw_args:
            print(f"PROGRESS: RECV {raw_arg}", flush=True)
            fpath = Path(raw_arg)
            if fpath.exists():
                files.append(fpath)
            else:
                 print(f"PROGRESS: ERR FILE NOT FOUND {raw_arg}", flush=True)
                 console.print(f"[red]Error: File {raw_arg} does not exist.[/red]")
        
        if not files:
            return
            
        console.print(f"[cyan]Multi-file mode: Processing {len(files)} files[/cyan]")
    else:
        # Default Directory Scan mode
        files = sorted([
            f for f in config.INPUT_DIR.iterdir() 
            if f.suffix.lower() in config.ACCEPTED_FORMATS
        ])
    
    if not files:
        console.print(f"[yellow]No audio files found in {config.INPUT_DIR}[/yellow]")
        print("PROGRESS: NO FILES FOUND", flush=True)
        return
    
    print(f"PROGRESS: FOUND {len(files)} FILES", flush=True)
    console.print(f"Found {len(files)} audio files to process.")
    
    all_report_data = []
    
    # 3. Processing Loop
    # Note: Progress is now reported from fingerprint.scan_audio_segment()
    print("PROGRESS: 0", flush=True)
    
    for audio_file in files:
        console.print(f"[cyan]Processing {audio_file.name}...[/cyan]")
        
        # Step A: Hybrid Analysis / Fingerprinting
        # This scans the file in chunks and reports progress internally
        raw_tracks = fingerprint.scan_audio_segment(str(audio_file))
        
        # Step B: Enrichment & normalization
        for track in raw_tracks:
            # Add file context
            track['Filename'] = audio_file.name
            track['Timestamp'] = _format_timestamp(track.get('timestamp_in_file', 0))
            
            # Enrich
            enriched = enrichment.enrich_metadata(track)
            
            # Map to final column names for Report
            row = {
                'Filename': enriched['Filename'],
                'Timestamp': enriched['Timestamp'],
                'Title': enriched.get('title'),
                'Artist': enriched.get('artist'),
                'Album': enriched.get('album'),
                'Label': enriched.get('label'),
                'Year': enriched.get('release_date', '')[:4] if enriched.get('release_date') else '',
                'ISRC': enriched.get('isrc'),
                'Confidence': enriched.get('score')
            }
            all_report_data.append(row)
    
    # Final progress for UI
    print("PROGRESS: 100", flush=True)
    
    # 4. Reporting
    timestamp_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    report_file = config.OUTPUT_DIR / f"Compliance_Report_{timestamp_str}.xlsx"
    
    console.print(f"[cyan]Generating report at {report_file}...[/cyan]")
    report.generate_excel_report(all_report_data, str(report_file))
    
    console.print("[bold green]Processing Complete![/bold green]")
    print("PROGRESS: COMPLETE", flush=True)

def _format_timestamp(seconds_str):
    """Converts seconds (string or float) to HH:MM:SS format."""
    try:
        seconds = float(seconds_str)
        return str(datetime.timedelta(seconds=int(seconds)))
    except:
        return seconds_str

if __name__ == "__main__":
    main()
