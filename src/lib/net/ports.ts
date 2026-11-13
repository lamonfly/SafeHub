// Ports tried during host discovery. A reply on any of them (open or
// refused) marks the host as up.
export const discoveryPorts = [22, 53, 80, 135, 443, 445, 3389, 5000, 8006, 8080, 9100, 62078];

// Common and home lab service ports, used for "scan ports".
export const knownPorts: Record<number, string> = {
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  110: "POP3",
  111: "RPC",
  135: "MS RPC",
  139: "NetBIOS",
  143: "IMAP",
  161: "SNMP",
  389: "LDAP",
  443: "HTTPS",
  445: "SMB",
  548: "AFP",
  554: "RTSP",
  631: "IPP",
  873: "rsync",
  993: "IMAPS",
  995: "POP3S",
  1883: "MQTT",
  1900: "UPnP",
  2019: "Caddy admin",
  2049: "NFS",
  2283: "Immich",
  3000: "Web (3000)",
  3306: "MySQL",
  3389: "RDP",
  5000: "DSM / Web (5000)",
  5001: "DSM HTTPS",
  5055: "Seerr",
  5353: "mDNS",
  5432: "PostgreSQL",
  5900: "VNC",
  6379: "Redis",
  6767: "Bazarr",
  7878: "Radarr",
  8000: "Web (8000)",
  8006: "Proxmox",
  8007: "Proxmox Backup",
  8008: "Chromecast",
  8009: "Chromecast",
  8080: "HTTP alt",
  8081: "Web (8081)",
  8096: "Jellyfin",
  8123: "Home Assistant",
  8384: "Syncthing",
  8443: "HTTPS alt",
  8920: "Jellyfin HTTPS",
  8989: "Sonarr",
  9000: "Portainer / Web",
  9090: "Prometheus / Cockpit",
  9100: "Printer / node exporter",
  9443: "Portainer HTTPS",
  9696: "Prowlarr",
  32400: "Plex",
  51413: "Transmission",
  62078: "Apple device",
};

export const topPorts = Object.keys(knownPorts).map(Number);

// Parses "22,80,8000-8100" into a sorted, unique port list.
export function parsePortList(value: string, maxPorts = 2_048): number[] | null {
  const ports = new Set<number>();
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    const match = part.match(/^(\d{1,5})(?:-(\d{1,5}))?$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end > 65_535 || start > end) return null;
    if (ports.size + (end - start + 1) > maxPorts) return null;
    for (let port = start; port <= end; port++) ports.add(port);
  }
  return ports.size > 0 ? [...ports].sort((a, b) => a - b) : null;
}
