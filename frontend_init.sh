#/bin/bash

# ARGC
ARGC=$1

if [ "${ARGC}" == "dev" ]; then
    echo "Running in development mode..."
    # if [ -e .postgresinit ]; then
    #     rm .postgresinit
    # fi
    # if [ -e .frontendinit ]; then
    #     rm .frontendinit
    # fi

    if [[ -f next.config.ts.example ]]; then
        sed "s/hostname\:\ \"localhost\".*/hostname\:\ \"${S3_HOST}\",/g" next.config.ts.example | sed "s/port\:\ \"9000\".*/port\:\ \"${S3_PORT}\",/g" >next.config.ts
    fi
else
    echo "Running in production mode..."
fi

if [ ! -f .postgresinit ]; then
    echo "PostgreSQL initialization started..."
    npx prisma migrate dev --name init
    npx prisma generate

    # Create a file to indicate that initialization has been done
    touch .postgresinit
    echo "PostgreSQL initialization completed."
else
    echo "PostgreSQL is already initialized. Skipping initialization."
fi

if [ ! -f .frontendinit ]; then
    echo "Frontend initialization started..."
    npm install
    npm audit fix 

    # Create a file to indicate that initialization has been done
    touch .frontendinit
    echo "Frontend initialization completed."
else
    echo "Frontend is already initialized. Skipping initialization."
fi

if [ "${ARGC}" == "dev" ]; then
    npm run dev 
else
    # build and start the frontend in production mode
    echo "Waiting for the frontend elements to be ready..."
    npm run build
    echo "Starting the frontend in production mode..."
    npm run start 
fi
