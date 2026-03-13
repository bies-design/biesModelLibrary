#/bin/bash

# ARGC
ARGC=$1

if [ "${ARGC}" == "dev" ]; then
    echo "Running in development mode..."
    if [ -e .tusserverinit ]; then
        rm .tusserverinit
    fi
else
    echo "Running in production mode..."
fi

if [ ! -f .tusserverinit ]; then
    echo "Tus-Server initialization started..."
    npm install
    npm audit fix 

    # Create a file to indicate that initialization has been done
    touch .tusserverinit
    echo "Tus-Server initialization completed."
else
    echo "Tus-Server is already initialized. Skipping initialization."
fi

if [ "${ARGC}" == "dev" ]; then
    npm run dev
else
    # build and start the tus-server in production mode
    echo "Waiting for the server to be ready before starting the tus-server..."
    npm run build
    echo "Starting the tus-server..."
    npm run start
fi
