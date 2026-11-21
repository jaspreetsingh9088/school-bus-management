import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'api.dart';

// ───────── Colours ─────────

const brand = Color(0xFFFFC400);
const ink = Color(0xFF12181F);
const navy = Color(0xFF16202C);
const blue = Color(0xFF1F6FEB);
const green = Color(0xFF1A7F37);
const amber = Color(0xFFB7791F);
const red = Color(0xFFC62828);

const headerGradient = LinearGradient(
  colors: [Color(0xFF12181F), Color(0xFF1B3A6B), Color(0xFF1F6FEB)],
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
);

Color statusColor(String status) {
  switch (status) {
    case 'BOARDED':
    case 'IN_PROGRESS':
      return blue;
    case 'AT_SCHOOL':
    case 'HANDED_OVER':
    case 'DROPPED_ALONE':
    case 'COMPLETED':
    case 'PAID':
      return green;
    case 'NO_SHOW':
    case 'PENDING_APPROVAL':
    case 'PENDING':
    case 'PARTLY_PAID':
      return amber;
    case 'HELD':
    case 'RETURNED':
    case 'OVERDUE':
      return red;
    default:
      return Colors.grey.shade600;
  }
}

String greeting() {
  final h = DateTime.now().hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ───────── Small pieces ─────────

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(statusLabel[status] ?? status, style: TextStyle(color: c, fontWeight: FontWeight.w700, fontSize: 12)),
    );
  }
}

/// Pulsing red dot with "LIVE".
class LiveBadge extends StatelessWidget {
  const LiveBadge({super.key, this.label = 'LIVE'});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: Colors.red.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 8, height: 8, decoration: const BoxDecoration(color: Colors.red, shape: BoxShape.circle))
            .animate(onPlay: (c) => c.repeat(reverse: true))
            .scale(begin: const Offset(0.7, 0.7), end: const Offset(1.3, 1.3), duration: 700.ms)
            .fade(begin: 0.5, end: 1),
        const SizedBox(width: 6),
        Text(label, style: const TextStyle(color: Colors.red, fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 0.8)),
      ]),
    );
  }
}

/// Rounded gradient header used at the top of home screens.
class GradientHeader extends StatelessWidget {
  const GradientHeader({super.key, required this.title, this.subtitle, this.trailing});
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.fromLTRB(20, MediaQuery.of(context).padding.top + 14, 12, 26),
      decoration: const BoxDecoration(
        gradient: headerGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w800))
                .animate()
                .fadeIn(duration: 400.ms)
                .slideX(begin: -0.1, end: 0),
            if (subtitle != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(subtitle!, style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14)),
              ).animate().fadeIn(delay: 150.ms, duration: 400.ms),
          ]),
        ),
        if (trailing != null) trailing!,
      ]),
    );
  }
}

/// Fade + slide in, staggered by index. Use on list items.
extension EnterAnimation on Widget {
  Widget enter(int index) => animate(delay: (80 * index).ms).fadeIn(duration: 350.ms).slideY(begin: 0.12, end: 0, curve: Curves.easeOutCubic);
}

// ───────── Map ─────────

/// Satellite (with place and road names) or street map tiles.
List<Widget> mapTiles({required bool satellite}) => satellite
    ? [
        TileLayer(
          urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          userAgentPackageName: 'in.schoolbus.app',
          maxZoom: 19,
        ),
        TileLayer(
          urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
          userAgentPackageName: 'in.schoolbus.app',
          maxZoom: 19,
        ),
        TileLayer(
          urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
          userAgentPackageName: 'in.schoolbus.app',
          maxZoom: 19,
        ),
      ]
    : [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'in.schoolbus.app',
          maxZoom: 19,
        ),
      ];

/// The road the bus follows: white casing under a blue line, like navigation apps.
List<Widget> roadLine(List<LatLng> points) => points.length < 2
    ? []
    : [
        PolylineLayer(polylines: [
          Polyline(points: points, strokeWidth: 9, color: Colors.white.withValues(alpha: 0.9)),
          Polyline(points: points, strokeWidth: 5, color: blue),
        ]),
      ];

/// Reads the API's [[lat, lng], …] path; falls back to straight lines between stops.
List<LatLng> pathFrom(dynamic path, List<LatLng> stops) {
  if (path is List && path.length > 1) {
    return path.map((p) => LatLng(((p as List)[0] as num).toDouble(), (p[1] as num).toDouble())).toList();
  }
  return stops;
}

class MapAttribution extends StatelessWidget {
  const MapAttribution({super.key, required this.satellite});
  final bool satellite;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.bottomLeft,
      child: Container(
        margin: const EdgeInsets.all(4),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        color: Colors.white.withValues(alpha: 0.75),
        child: Text(satellite ? '© Esri, Maxar' : '© OpenStreetMap', style: const TextStyle(fontSize: 10)),
      ),
    );
  }
}

/// Round floating button to switch Satellite / Street.
class MapStyleButton extends StatelessWidget {
  const MapStyleButton({super.key, required this.satellite, required this.onTap});
  final bool satellite;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: const CircleBorder(),
      elevation: 4,
      child: IconButton(
        tooltip: satellite ? 'Street map' : 'Satellite',
        icon: Icon(satellite ? Icons.map_outlined : Icons.satellite_alt_outlined, color: ink),
        onPressed: onTap,
      ),
    );
  }
}

/// Yellow bus marker with a soft pulse.
class BusMarker extends StatelessWidget {
  const BusMarker({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(alignment: Alignment.center, children: [
      Container(width: 46, height: 46, decoration: BoxDecoration(color: brand.withValues(alpha: 0.35), shape: BoxShape.circle))
          .animate(onPlay: (c) => c.repeat())
          .scale(begin: const Offset(0.6, 0.6), end: const Offset(1.4, 1.4), duration: 1400.ms)
          .fadeOut(duration: 1400.ms),
      Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: brand,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 3),
          boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6, offset: Offset(0, 2))],
        ),
        child: const Center(child: Text('🚌', style: TextStyle(fontSize: 19))),
      ),
    ]);
  }
}
