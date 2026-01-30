export interface VinResult {
  Make: string;
  Model: string;
  ModelYear: string;
  Trim: string;
  EngineHP: string;
  DisplacementL: string;
  TransmissionStyle: string;
  BodyClass: string;
  ErrorText: string;
  Series: string;
  VehicleType: string;
  EngineCylinders: string;
  EngineConfiguration: string;
  FuelTypePrimary: string;
  Turbo: string;
  TransmissionSpeeds: string;
  DriveType: string;
  AirBagLocFront: string;
  ABS: string;
  ESC: string;
  TractionControl: string;
  TPMS: string;
  GVWR: string;
  Doors: string;
  Seats: string;
  PlantCity: string;
  PlantState: string;
  PlantCountry: string;
  Manufacturer: string;
  [key: string]: string;
}

export interface VinDecodeResponse {
  Count: number;
  Message: string;
  SearchCriteria: string;
  Results: VinResult[];
}

export interface HistoryRecord {
  vin: string;
  make: string;
  model: string;
  year: string;
  thumbnail?: string;
  data: VinResult;
}

export async function decodeVin(vin: string): Promise<VinDecodeResponse> {
  const response = await fetch(`https://api.wheelbase.io/v1/vin/decode/${encodeURIComponent(vin)}`);
  
  if (!response.ok) {
    throw new Error(`Failed to decode VIN: ${response.statusText}`);
  }
  
  return response.json();
}

export async function saveHistory(tgUserId: string, record: HistoryRecord): Promise<void> {
  const response = await fetch(
    `https://api.daedalus.wheelbase.io/api/users/${encodeURIComponent(tgUserId)}/vin-history`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(record),
    }
  );
  
  if (!response.ok) {
    console.error('Failed to save history:', response.statusText);
  }
}

export async function saveHistoryToAPI(tgUserId: string, record: HistoryRecord): Promise<void> {
  const response = await fetch(
    `https://api.daedalus.wheelbase.io/api/users/${encodeURIComponent(tgUserId)}/vin-history`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vin: record.vin,
        make: record.make,
        model: record.model,
        year: parseInt(record.year) || 0,
        thumbnail: record.thumbnail || '',
        data: record.data,
        decoded_at: Date.now()
      }),
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to save history: ${response.statusText}`);
  }
}
