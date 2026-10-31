import { useCallback, useEffect, useState } from 'react';
import type { WeatherAlert, WeatherBundle } from '../engine/types';
import { getAlerts, getWeather } from '../engine/weather';
import { getNormals, type Normals } from '../engine/climate';

/** Forecast, alerts and climate normals for one point; refreshes every 30 minutes and on demand. */
export function useWeatherData(point: [number, number]) {
  const [weather, setWeather] = useState<WeatherBundle | null>(null);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<WeatherAlert[]>([]);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [normals, setNormals] = useState<Normals | null>(null);
  const key = `${point[0].toFixed(2)},${point[1].toFixed(2)}`;

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    const [lon, lat] = key.split(',').map(Number);
    const [w, a] = await Promise.all([getWeather(lat, lon, { force }), getAlerts(lat, lon)]);
    setWeather(w.bundle);
    setWeatherError(w.error);
    setAlerts(a.alerts);
    setAlertsError(a.error);
    setRefreshing(false);
  }, [key]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const [lon, lat] = key.split(',').map(Number); void getNormals(lat, lon).then(setNormals); }, [key]);
  useEffect(() => { const t = setInterval(() => void refresh(), 30 * 60 * 1000); return () => clearInterval(t); }, [refresh]);

  return { weather, weatherError, alerts, alertsError, refreshing, normals, refresh };
}
