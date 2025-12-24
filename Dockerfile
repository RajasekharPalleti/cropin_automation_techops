# Use an official Python runtime as a parent image
FROM python:3.9-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code
COPY . .

# Create necessary directories for the app if they don't exist (though main.py handles this too)
RUN mkdir -p uploads outputs

# Expose the port that the app runs on
# Railway injects a PORT environment variable, but we expose 4444 as a default/documentation
EXPOSE 4444

# Define the command to run the app
# We use shell form to properly expand the $PORT variable provided by Railway
CMD sh -c "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-4444}"
