import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'main.dart';

/// Driver and attendant home: today's trips.
class CrewHome extends StatefulWidget {
  const CrewHome({super.key});

  @override
  State<CrewHome> createState() => _CrewHomeState();
}

class _CrewHomeState extends State<CrewHome> {
  List<dynamic>? _trips;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final t = await Api.instance.get('/crew/trips/today') as List;
      if (mounted) setState(() => _trips = t);
    } catch (e) {
      if (mounted) {
        setState(() => _trips = []);
        showError(context, e);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = Api.instance.session!;
    return Scaffold(
      appBar: AppBar(
        title: Text('Hello, ${s.name.split(' ').first}'),
        actions: [IconButton(icon: const Icon(Icons.logout), onPressed: () => logoutAndRestart(context))],
      ),
      body: _trips == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(12), children: [
                Text('${s.role == 'DRIVER' ? 'Driver' : 'Attendant'} · ${s.companyName}', style: const TextStyle(color: Colors.grey)),
                const SizedBox(height: 8),
                if (_trips!.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No trips for you today. Pull down to refresh.')),
                for (final row in _trips!)
                  Card(
                    child: ListTile(
                      leading: Icon(row['trip']['direction'] == 'MORNING' ? Icons.wb_sunny : Icons.home, color: brand, size: 32),
                      title: Text(row['routeName'] as String, style: const TextStyle(fontWeight: FontWeight.bold)),
                      subtitle: Text('Bus ${row['busNumber']} · ${row['trip']['direction'] == 'MORNING' ? 'Morning pickup' : 'Afternoon drop-off'}'),
                      trailing: StatusChip(row['trip']['status'] as String),
                      onTap: () async {
                        await Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(tripId: row['trip']['id'] as String)));
                        _load();
                      },
                    ),
                  ),
              ]),
            ),
    );
  }
}

/// One trip: start, share location, mark each child, empty-bus check, end.
class TripScreen extends StatefulWidget {
  const TripScreen({super.key, required this.tripId});
  final String tripId;

  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen> {
  Map<String, dynamic>? _sheet;
  Timer? _poll;
  Timer? _upload;
  StreamSubscription<Position>? _gps;
  final List<Map<String, dynamic>> _points = [];
  final List<Map<String, dynamic>> _pendingEvents = [];
  Position? _last;
  bool _busy = false;
  String? _gpsProblem;
  final _rand = Random();

  String get _base => '/crew/trips/${widget.tripId}';
  Map<String, dynamic>? get _trip => _sheet?['trip'] as Map<String, dynamic>?;
  bool get _running => _trip?['status'] == 'IN_PROGRESS';
  bool get _morning => _trip?['direction'] == 'MORNING';

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 6), (_) => _load(quiet: true));
    _upload = Timer.periodic(const Duration(seconds: 5), (_) => _flush());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _upload?.cancel();
    _gps?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final s = await Api.instance.get(_base) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => _sheet = s);
      if (_running && _gps == null) _startGps();
      if (!_running && _gps != null) _stopGps();
    } catch (e) {
      if (!quiet && mounted) showError(context, e);
    }
  }

  Future<void> _act(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
    } on ApiException catch (e) {
      if (mounted) _showProblem(e);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _showProblem(ApiException e) {
    final students = e.body is Map ? (e.body['students'] as List?) : null;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Please check'),
        content: Text(students == null ? e.message : '${e.message}:\n\n${students.map((s) => '• ${s['name']} (${statusLabel[s['status']] ?? s['status']})').join('\n')}'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))],
      ),
    );
  }

  // ───────── GPS ─────────

  Future<void> _startGps() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      setState(() => _gpsProblem = 'Turn on location (GPS) so parents can see the bus.');
      return;
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      setState(() => _gpsProblem = 'Location permission is needed to share the bus position.');
      return;
    }
    setState(() => _gpsProblem = null);
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 5,
      intervalDuration: const Duration(seconds: 5),
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'School Bus trip running',
        notificationText: 'Sharing the bus location with parents',
        enableWakeLock: true,
      ),
    );
    _gps = Geolocator.getPositionStream(locationSettings: settings).listen((pos) {
      _last = pos;
      _points.add({
        'lat': pos.latitude,
        'lng': pos.longitude,
        'speedKmh': pos.speed < 0 ? 0 : pos.speed * 3.6,
        'heading': pos.heading,
        'accuracyM': pos.accuracy,
        'recordedAt': pos.timestamp.toUtc().toIso8601String(),
      });
      if (_points.length > 1000) _points.removeRange(0, _points.length - 1000);
    }, onError: (e) => setState(() => _gpsProblem = 'GPS error: $e'));
  }

  void _stopGps() {
    _gps?.cancel();
    _gps = null;
  }

  /// Sends saved GPS points and any boarding events that couldn't be sent earlier.
  Future<void> _flush() async {
    if (!_running) return;
    if (_points.isNotEmpty) {
      final batch = List<Map<String, dynamic>>.from(_points);
      try {
        await Api.instance.post('$_base/positions', {'points': batch});
        _points.removeRange(0, batch.length);
      } catch (_) {/* keep and retry */}
    }
    if (_pendingEvents.isNotEmpty) {
      final batch = List<Map<String, dynamic>>.from(_pendingEvents);
      try {
        await Api.instance.post('$_base/student-events', {'events': batch});
        _pendingEvents.removeRange(0, batch.length);
        _load(quiet: true);
      } catch (_) {/* keep and retry */}
    }
    if (mounted) setState(() {});
  }

  // ───────── Student actions ─────────

  Future<void> _mark(Map student, String to, {String? adultId, String? parentId}) async {
    final ev = <String, dynamic>{
      'clientEventId': '${DateTime.now().microsecondsSinceEpoch}-${_rand.nextInt(1 << 30)}',
      'studentId': student['studentId'],
      'toStatus': to,
      'occurredAt': DateTime.now().toUtc().toIso8601String(),
      if (_last != null) 'lat': _last!.latitude,
      if (_last != null) 'lng': _last!.longitude,
      if (adultId != null) 'authorizedAdultId': adultId,
      if (parentId != null) 'receivedByParentId': parentId,
    };
    setState(() => _busy = true);
    try {
      final res = await Api.instance.post('$_base/student-events', {'events': [ev]}) as List;
      final r = res.first as Map;
      if (r['ok'] != true && mounted) showError(context, r['error'] ?? 'Not saved');
      await _load();
    } on ApiException catch (e) {
      if (e.status == 0) {
        _pendingEvents.add(ev); // offline: send later, the id prevents double-counting
        if (mounted) showInfo(context, 'No signal. Saved — it will be sent automatically.');
      } else if (mounted) {
        showError(context, e);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _handOver(Map student) async {
    final adults = (student['authorizedAdults'] as List).cast<Map>();
    final parents = (student['parents'] as List).cast<Map>();
    final choice = await showDialog<Map<String, String>>(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: Text('Who is collecting ${student['name']}?'),
        children: [
          for (final p in parents)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, {'parentId': p['parentId'] as String}),
              child: Text('Parent (${(p['relation'] as String).toLowerCase()})'),
            ),
          for (final a in adults)
            SimpleDialogOption(
              onPressed: () => Navigator.pop(ctx, {'adultId': a['id'] as String}),
              child: Text('${a['name']} — ${a['relation']}'),
            ),
          if (parents.isEmpty && adults.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('No approved person on record. Hold the child and call the office.')),
        ],
      ),
    );
    if (choice == null) return;
    await _mark(student, 'HANDED_OVER', adultId: choice['adultId'], parentId: choice['parentId']);
  }

  List<Widget> _actions(Map student) {
    final st = student['status'] as String;
    Widget b(String label, VoidCallback onTap, {Color? color}) => Padding(
          padding: const EdgeInsets.only(right: 6, top: 6),
          child: FilledButton.tonal(
            style: FilledButton.styleFrom(backgroundColor: color?.withValues(alpha: 0.15), foregroundColor: color, visualDensity: VisualDensity.compact),
            onPressed: _busy || !_running ? null : onTap,
            child: Text(label),
          ),
        );
    final out = <Widget>[];
    if (st == 'SCHEDULED' || st == 'NO_SHOW') out.add(b('Boarded', () => _mark(student, 'BOARDED'), color: Colors.blue));
    if (st == 'SCHEDULED') out.add(b(_morning ? 'Not at stop' : 'Didn’t come', () => _mark(student, 'NO_SHOW'), color: Colors.orange));
    if (!_morning && (st == 'BOARDED' || st == 'HELD')) out.add(b('Hand over', () => _handOver(student), color: Colors.green));
    if (!_morning && st == 'BOARDED' && student['mayGoHomeAlone'] == true) out.add(b('Goes home alone', () => _mark(student, 'DROPPED_ALONE'), color: Colors.green));
    if (!_morning && st == 'BOARDED') out.add(b('No adult — hold', () => _mark(student, 'HELD'), color: Colors.red));
    if (!_morning && st == 'HELD') out.add(b('Return to school', () => _mark(student, 'RETURNED'), color: Colors.red));
    return out;
  }

  Future<bool> _confirm(String title, String text) async =>
      await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(title: Text(title), content: Text(text), actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Yes')),
        ]),
      ) ==
      true;

  Future<void> _incident() async {
    final type = await showDialog<String>(
      context: context,
      builder: (ctx) => SimpleDialog(title: const Text('Report'), children: [
        for (final t in const [['SOS', 'Emergency (SOS)'], ['BREAKDOWN', 'Breakdown'], ['DELAY', 'Delay'], ['ACCIDENT', 'Accident']])
          SimpleDialogOption(onPressed: () => Navigator.pop(ctx, t[0]), child: Text(t[1])),
      ]),
    );
    if (type == null) return;
    await _act(() async {
      await Api.instance.post('/crew/incidents', {
        'type': type,
        'tripId': widget.tripId,
        if (_last != null) 'lat': _last!.latitude,
        if (_last != null) 'lng': _last!.longitude,
      });
      if (mounted) showInfo(context, 'The office has been alerted.');
    });
  }

  @override
  Widget build(BuildContext context) {
    final sheet = _sheet;
    if (sheet == null) return Scaffold(appBar: AppBar(), body: const Center(child: CircularProgressIndicator()));
    final trip = _trip!;
    final stops = (sheet['stops'] as List).cast<Map>();
    final status = trip['status'] as String;

    return Scaffold(
      appBar: AppBar(
        title: Text(_morning ? 'Morning pickup' : 'Afternoon drop-off'),
        actions: [IconButton(icon: const Icon(Icons.report, color: Colors.red), tooltip: 'Report / SOS', onPressed: _incident)],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 100), children: [
          Row(children: [
            StatusChip(status),
            const SizedBox(width: 8),
            if (_running)
              Expanded(
                child: Text(
                  _gpsProblem ?? (_last == null ? 'Waiting for GPS…' : 'Sharing location · ${_points.length} to send${_pendingEvents.isEmpty ? '' : ' · ${_pendingEvents.length} marks waiting'}'),
                  style: TextStyle(fontSize: 12, color: _gpsProblem != null ? Colors.red : Colors.grey.shade700),
                ),
              ),
          ]),
          if (status == 'SCHEDULED') ...[
            const SizedBox(height: 16),
            FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              icon: const Icon(Icons.play_arrow),
              label: const Text('Start trip'),
              onPressed: _busy ? null : () => _act(() => Api.instance.post('$_base/start')),
            ),
          ],
          const SizedBox(height: 12),
          for (final stop in stops) _stopCard(stop),
        ]),
      ),
      bottomNavigationBar: _running
          ? SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(children: [
                  if (_morning && trip['arrivedSchoolAt'] == null)
                    Expanded(
                      child: FilledButton(
                        onPressed: _busy ? null : () async {
                          if (await _confirm('Reached school?', 'Everyone on the bus will be marked as reached school.')) {
                            _act(() => Api.instance.post('$_base/arrive-school'));
                          }
                        },
                        child: const Text('Reached school'),
                      ),
                    ),
                  if (!(_morning && trip['arrivedSchoolAt'] == null) && trip['emptyBusCheckedAt'] == null)
                    Expanded(
                      child: FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: Colors.deepOrange),
                        onPressed: _busy ? null : () async {
                          if (await _confirm('Empty-bus check', 'Walk to the back of the bus and check every seat. Is the bus empty?')) {
                            _act(() => Api.instance.post('$_base/empty-bus-check'));
                          }
                        },
                        child: const Text('Bus is empty ✓'),
                      ),
                    ),
                  if (trip['emptyBusCheckedAt'] != null)
                    Expanded(
                      child: FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: Colors.green.shade700),
                        onPressed: _busy ? null : () => _act(() async {
                          await _flush();
                          await Api.instance.post('$_base/end');
                        }),
                        child: const Text('End trip'),
                      ),
                    ),
                ]),
              ),
            )
          : null,
    );
  }

  Widget _stopCard(Map stop) {
    final kids = (stop['students'] as List).cast<Map>();
    final arrived = stop['arrivedAt'] != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(radius: 14, backgroundColor: arrived ? Colors.green : ink, child: Text('${stop['sequence']}', style: const TextStyle(color: Colors.white, fontSize: 12))),
            const SizedBox(width: 10),
            Expanded(child: Text('${stop['name']}', style: const TextStyle(fontWeight: FontWeight.bold))),
            Text('${stop['scheduledTime']}', style: const TextStyle(color: Colors.grey)),
          ]),
          if (_running && !arrived)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _busy ? null : () => _act(() => Api.instance.post('$_base/stops/${stop['routeStopId']}/arrive')),
                icon: const Icon(Icons.flag, size: 18),
                label: const Text('Reached this stop'),
              ),
            ),
          if (kids.isEmpty) const Padding(padding: EdgeInsets.only(top: 6), child: Text('No children here today', style: TextStyle(color: Colors.grey))),
          for (final k in kids)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(
                    child: Text('${k['name']}${k['className'] != null ? '  (Class ${k['className']})' : ''}', style: const TextStyle(fontSize: 15)),
                  ),
                  StatusChip(k['status'] as String),
                ]),
                if (k['specialInstructions'] != null) Text('Note: ${k['specialInstructions']}', style: const TextStyle(fontSize: 12, color: Colors.deepOrange)),
                Wrap(children: _actions(k)),
              ]),
            ),
        ]),
      ),
    );
  }
}
