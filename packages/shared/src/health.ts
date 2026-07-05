/** Antwortformat des /api/health-Endpoints – von API und Web-Client gemeinsam genutzt. */
export interface HealthStatus {
  status: 'ok';
  service: string;
  timestamp: string;
}
