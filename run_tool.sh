#!/bin/bash
# Activates venv if it exists, otherwise assumes global/user python
# Runs the radio compliance tool

# Check for .env
if [ ! -f .env ]; then
    echo "WARNING: .env file not found! Please create one with your API keys."
fi

echo "Starting Radio Compliance Tool..."
python3 -m src.main
