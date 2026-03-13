#/bin/bash

# ARGC
ARGC=$1

if [ "${ARGC}" == "dev" ]; then
    echo "Running in development mode..."
    if [ -e .ifctofragconvertworkerinit ]; then
        rm .ifctofragconvertworkerinit
    fi
else
    echo "Running in production mode..."
fi

if [ ! -f .ifctofragconvertworkerinit ]; then
    echo "IFC to Fragment Convert Worker initialization started..."
    npm install
    npm audit fix 

    # Create a file to indicate that initialization has been done
    touch .ifctofragconvertworkerinit
    echo "IFC to Fragment Convert Worker initialization completed."
else
    echo "IFC to Fragment Convert Worker is already initialized. Skipping initialization."
fi

if [ "${ARGC}" == "dev" ]; then
    npm run dev
else
    # build and start the worker in production mode
    echo "Waiting for the server to be ready before starting the convert worker..."
    npm run build
    echo "Starting the convert worker..."
    npm run start
fi