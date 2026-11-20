import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'api.dart';
import 'main.dart';

const consentVersion = '2026-11';

/// Parent home: each child, today's trips, live tracking, absences and alerts.
class ParentHome extends StatelessWidget {
  const ParentHome({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My children'),
        actions: [
          IconButton(
            icon: const Icon(Icons.notifications_none),
            tooltip: 'Alerts',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: const Text('Alerts')), body: const _Alerts()))),
          ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'sos') _sos(context);
              if (v == 'logout') logoutAndRestart(context);
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'sos', child: ListTile(leading: Icon(Icons.sos, color: Colors.red), title: Text('Emergency (SOS)'))),
              PopupMenuItem(value: 'logout', child: ListTile(leading: Icon(Icons.logout), title: Text('Log out'))),
            ],
          ),
        ],
      ),
      body: const _Children(),
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
          OutlinedButton.icon(style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)), onPressed: _link, icon: const Icon(Icons.add), label: const Text('Add a child with a code')),
        ],
      ),
    );
  }
}

/// Plain-language status for a child's trip.
String childStatusText(String status, String direction, String name) {
  final morning = direction == 'MORNING';
  switch (status) {
    case 'SCHEDULED':
      return morning ? 'Bus is on the way to pick up $name' : '$name is waiting for the bus at school';
    case 'BOARDED':
      return morning ? '$name is on the bus to school' : '$name is on the bus home';
    case 'AT_SCHOOL':
      return '$name reached school ✓';
    case 'HANDED_OVER':
    case 'DROPPED_ALONE':
      return '$name was dropped home ✓';
    case 'ABSENT':
      return 'Marked absent — no pickup';
    case 'NO_SHOW':
      return morning ? '$name was not at the stop' : '$name did not come to the bus';
    case 'HELD':
      return '$name is safe on the bus. Please call the office';
    case 'RETURNED':
      return '$name is being taken back to school';
    default:
      return statusLabel[status] ?? status;
  }
}

class _ChildCard extends StatelessWidget {
  const _ChildCard({required this.child, required this.trips, required this.onChanged});
  final Map<String, dynamic> child;
  final List<dynamic> trips;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final name = (child['name'] as String).split(' ').first;
    final morning = child['morning'] as Map?;
    final afternoon = child['afternoon'] as Map?;
    final running = trips.cast<Map>().where((t) => t['canTrack'] == true).toList();
    final latest = running.isNotEmpty ? running.first : (trips.isNotEmpty ? trips.cast<Map>().last : null);
    final pending = child['status'] == 'PENDING_APPROVAL';

    return Card(
      margin: const EdgeInsets.only(bottom: 14),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(radius: 22, backgroundColor: brand, child: Text(name.substring(0, 1), style: const TextStyle(fontSize: 18, color: ink))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(child['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                Text('${child['school']}', style: TextStyle(fontSize: 13, color: Colors.grey.shade700)),
              ]),
            ),
          ]),
          const SizedBox(height: 14),
          if (pending)
            const _StatusBox(text: 'Waiting for the transport office to approve', color: Color(0xFF9A6700))
          else if (latest != null)
            _StatusBox(
              text: childStatusText(latest['studentStatus'] as String, latest['direction'] as String, name),
              color: statusColor(latest['studentStatus'] as String),
            )
          else
            const _StatusBox(text: 'No bus trip right now', color: Colors.grey),
          if (running.isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                icon: const Icon(Icons.directions_bus),
                label: const Text('See the bus on the map', style: TextStyle(fontSize: 16)),
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TrackScreen(tripId: running.first['tripId'] as String))),
              ),
            ),
          ],
          if (morning != null || afternoon != null) ...[
            const SizedBox(height: 12),
            Text(
              [
                if (morning != null) 'Pickup ${morning['time']} · ${morning['stopName']}',
                if (afternoon != null) 'Drop ${afternoon['time']}',
              ].join('   •   '),
              style: TextStyle(fontSize: 13, color: Colors.grey.shade700),
            ),
          ],
          if (!pending)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(icon: const Icon(Icons.event_busy, size: 18), label: const Text('Won’t need the bus'), onPressed: () => _absent(context)),
            ),
        ]),
      ),
    );
  }

  Future<void> _absent(BuildContext context) async {
    final now = DateTime.now();
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ListTile(title: Text('When won’t your child need the bus?', style: TextStyle(fontWeight: FontWeight.bold))),
          ListTile(leading: const Icon(Icons.today), title: const Text('Today (whole day)'), onTap: () => Navigator.pop(ctx, 'today')),
          ListTile(leading: const Icon(Icons.wb_twilight), title: const Text('Today, afternoon only'), onTap: () => Navigator.pop(ctx, 'today-pm')),
          ListTile(leading: const Icon(Icons.event), title: const Text('Tomorrow (whole day)'), onTap: () => Navigator.pop(ctx, 'tomorrow')),
          ListTile(leading: const Icon(Icons.calendar_month), title: const Text('Choose a date…'), onTap: () => Navigator.pop(ctx, 'pick')),
        ]),
      ),
    );
    if (choice == null || !context.mounted) return;
    DateTime? date;
    String? direction;
    if (choice == 'today') date = now;
    if (choice == 'today-pm') {
      date = now;
      direction = 'AFTERNOON';
    }
    if (choice == 'tomorrow') date = now.add(const Duration(days: 1));
    if (choice == 'pick') {
      date = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 60)), initialDate: now.add(const Duration(days: 1)));
    }
    if (date == null) return;
    final d = '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
    try {
      await Api.instance.post('/parent/absences', {'studentId': child['studentId'], 'date': d, if (direction != null) 'direction': direction});
      if (context.mounted) showInfo(context, 'Done. The driver has been told.');
      await onChanged();
    } catch (e) {
      if (context.mounted) showError(context, e);
    }
  }
}

class _StatusBox extends StatelessWidget {
  const _StatusBox({required this.text, required this.color});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 15)),
    );
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
