import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'api.dart';
import 'main.dart';

const consentVersion = '2026-11';

/// Parent home: each child, today's trips, live tracking, absences and alerts.
class ParentHome extends StatefulWidget {
  const ParentHome({super.key});

  @override
  State<ParentHome> createState() => _ParentHomeState();
}

class _ParentHomeState extends State<ParentHome> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_tab == 0 ? 'My children' : 'Alerts'),
        actions: [
          IconButton(icon: const Icon(Icons.sos, color: Colors.red), tooltip: 'Emergency', onPressed: () => _sos(context)),
          IconButton(icon: const Icon(Icons.logout), tooltip: 'Log out', onPressed: () => logoutAndRestart(context)),
        ],
      ),
      body: _tab == 0 ? const _Children() : const _Alerts(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.child_care), label: 'Children'),
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Alerts'),
        ],
      ),
    );
  }
}

Future<void> _sos(BuildContext context) async {
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Send an emergency alert?'),
      content: TextField(controller: note, decoration: const InputDecoration(hintText: 'What happened? (optional)')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
        FilledButton(style: FilledButton.styleFrom(backgroundColor: Colors.red), onPressed: () => Navigator.pop(ctx, true), child: const Text('Send SOS')),
      ],
    ),
  );
  if (ok != true) return;
  try {
    await Api.instance.post('/parent/sos', {'type': 'SOS', if (note.text.trim().isNotEmpty) 'note': note.text.trim()});
    if (context.mounted) showInfo(context, 'The transport office has been alerted.');
  } catch (e) {
    if (context.mounted) showError(context, e);
  }
}

class _Children extends StatefulWidget {
  const _Children();

  @override
  State<_Children> createState() => _ChildrenState();
}

class _ChildrenState extends State<_Children> {
  bool _loading = true;
  bool _consent = true;
  List<Map<String, dynamic>> _kids = [];
  final Map<String, List<dynamic>> _today = {};
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final me = await Api.instance.get('/parent/me');
      final kids = ((await Api.instance.get('/parent/children')) as List).cast<Map<String, dynamic>>();
      for (final k in kids) {
        final t = await Api.instance.get('/parent/children/${k['studentId']}/today');
        _today[k['studentId'] as String] = t['trips'] as List;
      }
      if (!mounted) return;
      setState(() {
        _consent = me['consentGiven'] == true;
        _kids = kids;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      if (!quiet) showError(context, e);
    }
  }

  Future<void> _giveConsent() async {
    try {
      await Api.instance.post('/parent/consent', {'version': consentVersion});
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _link() async {
    final code = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add your child'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Text('Enter the 8-letter code from the transport office.'),
          TextField(controller: code, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Code')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Add')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final res = await Api.instance.post('/parent/children/link', {'activationCode': code.text.trim()});
      if (mounted) showInfo(context, '${res['name']} added.');
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (!_consent) {
      return ListView(padding: const EdgeInsets.all(24), children: [
        Text('Privacy notice', style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 12),
        const Text(
          'To keep your child safe, the transport company stores your child’s name, school, class, photo, '
          'pickup point and trip records, and shows you the bus location only while your child’s trip is running. '
          'You can ask to see, correct or delete this information at any time by contacting the transport office.',
        ),
        const SizedBox(height: 20),
        FilledButton(onPressed: _giveConsent, child: const Text('I agree')),
      ]);
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (_kids.isEmpty)
            const Padding(padding: EdgeInsets.all(24), child: Text('No children yet. Tap “Add child” and enter the code from the transport office.')),
          for (final k in _kids) _ChildCard(child: k, trips: _today[k['studentId']] ?? const [], onChanged: _load),
          const SizedBox(height: 12),
          OutlinedButton.icon(onPressed: _link, icon: const Icon(Icons.add), label: const Text('Add child')),
        ],
      ),
    );
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child, required this.trips, required this.onChanged});
  final Map<String, dynamic> child;
  final List<dynamic> trips;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final morning = child['morning'] as Map?;
    final afternoon = child['afternoon'] as Map?;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(backgroundColor: brand, child: Text((child['name'] as String).substring(0, 1))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(child['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${child['school']}${child['className'] != null ? ' · Class ${child['className']}' : ''}', style: const TextStyle(fontSize: 12)),
              ]),
            ),
            if (child['status'] != 'ACTIVE') StatusChip(child['status'] as String),
          ]),
          const Divider(height: 24),
          if (morning != null) _planLine('Morning pickup', morning),
          if (afternoon != null) _planLine('Afternoon drop', afternoon),
          if (trips.isNotEmpty) ...[
            const SizedBox(height: 8),
            const Text('Today', style: TextStyle(fontWeight: FontWeight.bold)),
            for (final t in trips)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Row(children: [
                  Expanded(child: Text(t['direction'] == 'MORNING' ? 'Morning' : 'Afternoon')),
                  StatusChip(t['studentStatus'] as String),
                  const SizedBox(width: 8),
                  if (t['canTrack'] == true)
                    FilledButton.icon(
                      icon: const Icon(Icons.directions_bus, size: 18),
                      label: const Text('Track'),
                      onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TrackScreen(tripId: t['tripId'] as String))),
                    ),
                ]),
              ),
          ],
          const SizedBox(height: 8),
          Wrap(spacing: 8, children: [
            OutlinedButton.icon(icon: const Icon(Icons.event_busy, size: 18), label: const Text('Mark absent'), onPressed: () => _absent(context)),
          ]),
        ]),
      ),
    );
  }

  Widget _planLine(String label, Map plan) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Text('$label: ${plan['time']} at ${plan['stopName']}${plan['busNumber'] != null ? ' · Bus ${plan['busNumber']}' : ''}'),
      );

  Future<void> _absent(BuildContext context) async {
    final now = DateTime.now();
    final date = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 60)), initialDate: now);
    if (date == null || !context.mounted) return;
    final direction = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(title: const Text('Which trip?'), children: [
        SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'ALL'), child: const Text('Whole day')),
        SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'MORNING'), child: const Text('Morning pickup only')),
        SimpleDialogOption(onPressed: () => Navigator.pop(ctx, 'AFTERNOON'), child: const Text('Afternoon drop-off only')),
      ]),
    );
    if (direction == null) return;
    final d = '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    try {
      await Api.instance.post('/parent/absences', {
        'studentId': child['studentId'],
        'date': d,
        if (direction != 'ALL') 'direction': direction,
      });
      if (context.mounted) showInfo(context, 'Marked absent. The driver has been told.');
      await onChanged();
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}

class _Alerts extends StatefulWidget {
  const _Alerts();

  @override
  State<_Alerts> createState() => _AlertsState();
}

class _AlertsState extends State<_Alerts> {
  List<dynamic>? _items;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final items = await Api.instance.get('/parent/notifications') as List;
      if (mounted) setState(() => _items = items);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (items == null) return const Center(child: CircularProgressIndicator());
    if (items.isEmpty) return const Center(child: Text('No alerts yet.'));
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.separated(
        itemCount: items.length,
        separatorBuilder: (_, __) => const Divider(height: 1),
        itemBuilder: (_, i) {
          final n = items[i] as Map;
          final at = DateTime.parse(n['createdAt'] as String).toLocal();
          return ListTile(
            leading: Icon(n['safety'] == true ? Icons.shield : Icons.notifications, color: n['safety'] == true ? Colors.blue : Colors.grey),
            title: Text(n['title'] as String, style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('${n['body']}\n${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}, ${at.day}/${at.month}'),
            isThreeLine: true,
          );
        },
      ),
    );
  }
}

/// Live map of the bus with ETA to the child's stop. Refreshes every 5 seconds.
class TrackScreen extends StatefulWidget {
  const TrackScreen({super.key, required this.tripId});
  final String tripId;

  @override
  State<TrackScreen> createState() => _TrackScreenState();
}

class _TrackScreenState extends State<TrackScreen> {
  Map<String, dynamic>? _live;
  String? _error;
  Timer? _timer;
  final _map = MapController();
  bool _centred = false;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final live = await Api.instance.get('/parent/trips/${widget.tripId}/live') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _live = live;
        _error = null;
      });
      final bus = live['bus'] as Map?;
      if (bus != null && !_centred) {
        _centred = true;
        _map.move(LatLng((bus['lat'] as num).toDouble(), (bus['lng'] as num).toDouble()), 14);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _error = e.status == 403 ? 'This trip has ended.' : e.message);
      if (e.status == 403) _timer?.cancel();
    }
  }

  @override
  Widget build(BuildContext context) {
    final live = _live;
    final route = (live?['route'] as List? ?? []).cast<Map>();
    final bus = live?['bus'] as Map?;
    final school = live?['school'] as Map?;
    final kids = (live?['children'] as List? ?? []).cast<Map>();
    LatLng p(Map m) => LatLng((m['lat'] as num).toDouble(), (m['lng'] as num).toDouble());
    final start = bus != null ? p(bus) : (route.isNotEmpty ? p(route.first) : const LatLng(20.59, 78.96));

    return Scaffold(
      appBar: AppBar(title: Text(live?['direction'] == 'AFTERNOON' ? 'Bus coming home' : 'Bus to school')),
      body: Column(children: [
        if (_error != null) Container(width: double.infinity, color: Colors.red.shade50, padding: const EdgeInsets.all(12), child: Text(_error!)),
        Expanded(
          child: FlutterMap(
            mapController: _map,
            options: MapOptions(initialCenter: start, initialZoom: 13),
            children: [
              TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'in.schoolbus.app'),
              if (route.length > 1)
                PolylineLayer(polylines: [Polyline(points: route.map(p).toList(), strokeWidth: 4, color: Colors.blue.withValues(alpha: 0.6))]),
              MarkerLayer(markers: [
                for (final s in route)
                  Marker(
                    point: p(s),
                    width: 22,
                    height: 22,
                    child: Container(decoration: BoxDecoration(color: s['reached'] == true ? Colors.green : ink, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2))),
                  ),
                for (final k in kids)
                  if (k['stop'] != null)
                    Marker(point: p(k['stop'] as Map), width: 36, height: 36, child: const Icon(Icons.home, color: Colors.deepOrange, size: 32)),
                if (school != null && school['lat'] != null)
                  Marker(point: p(school), width: 32, height: 32, child: const Text('🏫', style: TextStyle(fontSize: 26))),
                if (bus != null)
                  Marker(
                    point: p(bus),
                    width: 40,
                    height: 40,
                    child: Container(
                      decoration: BoxDecoration(color: brand, shape: BoxShape.circle, border: Border.all(color: ink, width: 2)),
                      child: const Center(child: Text('🚌', style: TextStyle(fontSize: 20))),
                    ),
                  ),
              ]),
            ],
          ),
        ),
        if (live != null) _InfoPanel(live: live, kids: kids, onCentre: bus == null ? null : () => _map.move(p(bus), 15)),
      ]),
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.live, required this.kids, this.onCentre});
  final Map<String, dynamic> live;
  final List<Map> kids;
  final VoidCallback? onCentre;

  @override
  Widget build(BuildContext context) {
    final bus = live['bus'] as Map?;
    final lost = live['signalLost'] == true;
    final toSchool = live['toSchool'] as Map?;
    return Material(
      elevation: 8,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          if (lost)
            Container(
              padding: const EdgeInsets.all(10),
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(8)),
              child: Text(bus == null ? 'Waiting for the bus location…' : 'GPS signal lost. Showing the last known position (${bus['ageSeconds']}s ago).'),
            ),
          for (final k in kids) ...[
            Row(children: [
              Expanded(child: Text(_eta(k), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
              StatusChip(k['status'] as String),
            ]),
            if (k['stop'] != null) Text('Stop: ${(k['stop'] as Map)['name']}'),
            const SizedBox(height: 6),
          ],
          if (toSchool != null) Text('To school: ${(((toSchool['distanceM'] as num) / 1000)).toStringAsFixed(1)} km, about ${((toSchool['etaSeconds'] as num) / 60).ceil()} min'),
          if (bus != null)
            Row(children: [
              Text('Speed ${(bus['speedKmh'] as num? ?? 0).round()} km/h · updated ${bus['ageSeconds']}s ago', style: const TextStyle(fontSize: 12, color: Colors.grey)),
              const Spacer(),
              if (onCentre != null) TextButton.icon(onPressed: onCentre, icon: const Icon(Icons.my_location, size: 18), label: const Text('Find bus')),
            ]),
        ]),
      ),
    );
  }

  String _eta(Map k) {
    if (k['busReachedStop'] == true) return live['direction'] == 'MORNING' ? 'Bus has reached your stop' : 'Bus is at your stop';
    final eta = k['etaSeconds'] as num?;
    final dist = k['distanceM'] as num?;
    if (eta == null || dist == null) return 'Bus has passed your stop';
    final mins = (eta / 60).ceil();
    return 'Bus is ${(dist / 1000).toStringAsFixed(1)} km away · about $mins min';
  }
}
