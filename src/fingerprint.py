import logging
import asyncio
from io import BytesIO
from pydub import AudioSegment
from shazamio import Shazam, Serialize

try:
    from . import config
except ImportError:
    import config

# Initialize Shazam instance
shazam = Shazam()

def scan_audio_segment(file_path):
    """
    Scans an audio segment.
    Since we are scanning individual songs now, we only check one chunk
    from the middle to save time.
    """
    logging.info(f"Scanning file: {file_path}")
    
    try:
        audio = AudioSegment.from_file(file_path)
    except Exception as e:
        logging.error(f"Failed to load audio file {file_path}: {e}")
        return []
    
    # Sampling Strategy: Check every 60 seconds
    video_len_ms = len(audio)
    chunk_len_ms = 15 * 1000  # Shazam works well with shorter 10-15s chunks
    step_ms = 60 * 1000  # Check every 1 minute
    
    current_ms = 0
    identified_tracks = []
    
    # Calculate total chunks for progress reporting
    total_chunks = (video_len_ms // step_ms) + 1
    chunk_index = 0
    
    # Run loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    while current_ms < video_len_ms:
        end_ms = min(current_ms + chunk_len_ms, video_len_ms)
        chunk = audio[current_ms:end_ms]
        timestamp = f"{current_ms/1000:.0f}"
        
        # Report progress to Electron UI
        chunk_index += 1
        progress_percent = int((chunk_index / total_chunks) * 100)
        print(f"PROGRESS: {progress_percent}", flush=True)
        logging.info(f"Processing chunk {chunk_index}/{total_chunks} at {timestamp}s ({progress_percent}%)")
        
        if chunk.rms < 50:
            logging.info(f"Skipping silent chunk at {timestamp}s")
        else:
            result = loop.run_until_complete(_identify_chunk_async(chunk))
            
            if result:
                result['timestamp_in_file'] = timestamp
                identified_tracks.append(result)
            else:
                # Log Unknown so we know we checked
                identified_tracks.append({
                    'timestamp_in_file': timestamp,
                    'title': '[Unknown / Speech]',
                    'artist': '',
                    'album': '',
                    'label': '',
                    'release_date': '',
                    'isrc': '',
                    'score': 0
                })
        
        current_ms += step_ms
    
    return _deduplicate_tracks(identified_tracks)

def _deduplicate_tracks(tracks):
    """
    Collapses consecutive identical tracks into one entry.
    Keeps the FIRST occurrence (earliest timestamp).
    """
    if not tracks:
        return []
    
    unique_tracks = []
    last_track_signature = None
    
    for track in tracks:
        # Create a signature based on Title + Artist
        title = track.get('title', '').strip().lower()
        artist = track.get('artist', '').strip().lower()
        
        # Determine current signature
        current_signature = f"{title}|{artist}"
        
        # FILTER: Skip Unknown / Silence / Speech
        if title in ['[unknown song]', '[unknown / speech]', '[silence]']:
            continue
        
        if current_signature != last_track_signature:
            unique_tracks.append(track)
            last_track_signature = current_signature
    
    return unique_tracks

async def _identify_chunk_async(audio_chunk):
    """
    Exports chunk to bytes and sends to Shazam via shazamio.
    """
    # Export to RAM
    buffer = BytesIO()
    audio_chunk.export(buffer, format="mp3")
    buffer.seek(0)
    data = buffer.read()
    
    try:
        logging.info("Sending chunk to Shazam...")
        # Use the correct method: recognize
        out = await shazam.recognize(data)
        
        # Parse Shazam response
        if 'track' in out:
            track_info = out['track']
            title = track_info.get('title')
            subtitle = track_info.get('subtitle') # Usually Artist
            
            logging.info(f"Match found: {title} by {subtitle}")
            
            # Extract Metadata
            metadata = {
                'title': title,
                'artist': subtitle,
                'album': '',
                'label': track_info.get('label', ''),
                'release_date': '',
                'isrc': track_info.get('isrc', ''),
                'score': 100
            }
            
            if 'sections' in track_info:
                for section in track_info['sections']:
                    if section.get('type') == 'SONG':
                        for meta in section.get('metadata', []):
                            if meta.get('title') == 'Album':
                                metadata['album'] = meta.get('text')
                            if meta.get('title') == 'Label':
                                metadata['label'] = meta.get('text')
                            if meta.get('title') == 'Released':
                                metadata['release_date'] = meta.get('text')
            
            return metadata
        else:
            logging.info("No match found for chunk.")
            return None
    
    except Exception as e:
        logging.error(f"Error calling Shazam: {e}")
        return None
