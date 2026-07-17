import { IsUrl, MaxLength } from 'class-validator';
import type { UnfurlRequest } from '@parley/shared';

/** Body von POST /api/unfurl. Nur http(s); der SSRF-Schutz im Service prüft
 * zusätzlich die Ziel-IP (interne Netze werden geblockt). require_tld ist für
 * lokale Tests aus – der IP-Check fängt localhost/interne Namen ohnehin ab. */
export class UnfurlDto implements UnfurlRequest {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2048)
  url!: string;
}
