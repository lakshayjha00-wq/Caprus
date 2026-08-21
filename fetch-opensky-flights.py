import requests
import pandas as pd
from datetime import datetime

def fetch_global_flights():
    """
    Fetches real-time global aircraft data using the OpenSky Network API.
    This aggregates ADS-B and Mode S transponder data (ATC data).
    """
    # OpenSky API endpoint for all current aircraft state vectors globally
    url = "https://opensky-network.org/api/states/all"
    
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Pinging global ADS-B network...")
    print("Fetching live satellite and ground-sensor flight data. This may take a moment...\n")
    
    try:
        # Fetching data. Unauthenticated requests are free but slightly delayed/rate-limited.
        response = requests.get(url, timeout=20)
        response.raise_for_status()
        
        data = response.json()
        states = data.get('states', [])
        
        if not states:
            print("No flight data received from the network.")
            return

        print(f"Success! Captured {len(states)} aircraft currently broadcasting.\n")
        
        # Parse the raw array data into a readable dictionary format
        flight_list = []
        for flight in states:
            # OpenSky state vector elements:
            # 0: icao24, 1: callsign, 2: origin_country, 5: longitude, 6: latitude, 7: baro_altitude, 8: on_ground, 9: velocity
            flight_data = {
                "ICAO24_ID": flight[0],
                "Callsign": str(flight[1]).strip() if flight[1] else "N/A",
                "Origin Country": flight[2],
                "Longitude": flight[5],
                "Latitude": flight[6],
                "Altitude (m)": flight[7], # Barometric altitude
                "Velocity (m/s)": flight[9],
                "On Ground": "Yes" if flight[8] else "No"
            }
            flight_list.append(flight_data)
            
        # Convert to a Pandas DataFrame for clean tabular analysis
        df = pd.DataFrame(flight_list)
        
        # Filter the data frame based on flight status
        in_air = df[df["On Ground"] == "No"]
        on_ground = df[df["On Ground"] == "Yes"]
        
        # Display the aggregate data
        print("=== GLOBAL FLIGHT SUMMARY ===")
        print(f"Total Aircraft Tracked: {len(df)}")
        print(f"Aircraft in the Air:    {len(in_air)}")
        print(f"Aircraft on the Ground: {len(on_ground)}\n")
        
        print("=== SAMPLE OF FLIGHTS CURRENTLY IN THE AIR ===")
        # Drop missing coordinates for a cleaner display and show the top 10
        clean_in_air = in_air.dropna(subset=['Longitude', 'Latitude'])
        print(clean_in_air.head(10).to_string(index=False))
        
        print("\n=== SAMPLE OF FLIGHTS CURRENTLY ON THE GROUND ===")
        clean_on_ground = on_ground.dropna(subset=['Longitude', 'Latitude'])
        print(clean_on_ground.head(10).to_string(index=False))

    except requests.exceptions.RequestException as e:
        print(f"Failed to retrieve satellite/ATC data. Error: {e}")

if __name__ == "__main__":
    fetch_global_flights()
