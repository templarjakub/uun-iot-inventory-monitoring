
# IoT Inventory Monitoring

A semester project developed at Unicorn University for the Internet of Things course.

## Overview

The project aims to develop an IoT-based inventory monitoring system for small parts and materials, such as screws, nuts, and bolts.

The system estimates the number of items in storage containers using weight measurements. Multiple weighing stations can track the same product, allowing inventory quantities to be aggregated automatically.

## Key Features

- Automatic inventory estimation based on weight
- Calibration using a known number of items
- Support for multiple products and weighing stations
- Aggregated inventory across multiple containers
- Low-stock indicators
- Measurement availability and freshness monitoring

## Architecture

The solution consists of three main components:

- **IoT Nodes** – Collect weight measurements
- **Gateway** – Processes and forwards measurements
- **Cloud Application** – Stores data and provides inventory management

## Documentation

- `vision.txt` – Project vision
- `dictionary.txt` – Business terminology
- `context.txt` – Business context
- `user-stories.txt` – Key user stories and scenarios

## Project Status

Semester project – MVP under development.
