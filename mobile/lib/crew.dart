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

  /// One big button for the usual next step, and a menu for the rare ones.
  Widget _studentActions(Map student) {
    final st = student['status'] as String;
    final enabled = !_busy && _running;
    String? mainLabel;
    VoidCallback? main;
    if (st == 'SCHEDULED' || st == 'NO_SHOW') {
      mainLabel = 'Boarded';
      main = () => _mark(student, 'BOARDED');
    } else if (!_morning && (st == 'BOARDED' || st == 'HELD')) {
      mainLabel = 'Hand over';
      main = () => _handOver(student);
    }
    final more = <PopupMenuEntry<String>>[
      if (st == 'SCHEDULED') PopupMenuItem(value: 'NO_SHOW', child: Text(_morning ? 'Not at the stop' : 'Didn’t come to the bus')),
      if (!_morning && st == 'BOARDED' && student['mayGoHomeAlone'] == true) const PopupMenuItem(value: 'DROPPED_ALONE', child: Text('Goes home alone (allowed)')),
      if (!_morning && st == 'BOARDED') const PopupMenuItem(value: 'HELD', child: Text('No adult here — keep on bus')),
      if (!_morning && st == 'HELD') const PopupMenuItem(value: 'RETURNED', child: Text('Take back to school')),
    ];
    return Row(mainAxisSize: MainAxisSize.min, children: [
      if (main != null)
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size(110, 44), backgroundColor: mainLabel == 'Boarded' ? const Color(0xFF1F6FEB) : const Color(0xFF1A7F37)),
          onPressed: enabled ? main : null,
          child: Text(mainLabel!, style: const TextStyle(fontSize: 15)),
        )
      else
        StatusChip(st),
      if (more.isNotEmpty)
        PopupMenuButton<String>(
          enabled: enabled,
          icon: const Icon(Icons.more_vert),
          itemBuilder: (_) => more,
          onSelected: (to) => _mark(student, to),
        ),
    ]);
  }

  /// The single big button at the bottom, for the trip's next step.
  Widget? _nextStep(Map<String, dynamic> trip) {
    final status = trip['status'] as String;
    String? label;
    Color color = const Color(0xFF1F6FEB);
    Future<void> Function()? run;
    if (status == 'SCHEDULED') {
      label = 'Start trip';
      run = () => _act(() => Api.instance.post('$_base/start'));
    } else if (status == 'IN_PROGRESS' && _morning && trip['arrivedSchoolAt'] == null) {
      label = 'Reached school';
      run = () async {
        if (await _confirm('Reached school?', 'Everyone on the bus will be marked as reached school.')) {
          await _act(() => Api.instance.post('$_base/arrive-school'));
        }
      };
    } else if (status == 'IN_PROGRESS' && trip['emptyBusCheckedAt'] == null) {
      label = 'Check bus is empty';
      color = Colors.deepOrange;
      run = () async {
        if (await _confirm('Is the bus empty?', 'Walk to the back of the bus and check every seat.')) {
          await _act(() => Api.instance.post('$_base/empty-bus-check'));
        }
      };
    } else if (status == 'IN_PROGRESS') {
      label = 'End trip';
      color = const Color(0xFF1A7F37);
      run = () => _act(() async {
            await _flush();
            await Api.instance.post('$_base/end');
          });
    }
    if (label == null) return null;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56), backgroundColor: color),
          onPressed: _busy ? null : run,
          child: Text(label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        ),
      ),
    );
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
    final kids = stops.expand((s) => (s['students'] as List).cast<Map>()).toList();
    final onBus = kids.where((k) => k['status'] == 'BOARDED' || k['status'] == 'HELD').length;

    return Scaffold(
      appBar: AppBar(
        title: Text(_morning ? 'Morning pickup' : 'Afternoon drop-off'),
        actions: [IconButton(icon: const Icon(Icons.sos, color: Colors.red), tooltip: 'Report a problem', onPressed: _incident)],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), children: [
          _Banner(
            title: status == 'SCHEDULED'
                ? 'Trip not started'
                : status == 'COMPLETED'
                    ? 'Trip finished ✓'
                    : '$onBus on the bus · ${kids.length} today',
            subtitle: !_running
                ? null
                : _gpsProblem ??
                    (_last == null
                        ? 'Finding GPS…'
                        : _pendingEvents.isEmpty
                            ? 'Parents can see the bus'
                            : 'No signal — ${_pendingEvents.length} change(s) will be sent'),
            warn: _gpsProblem != null,
          ),
          const SizedBox(height: 10),
          for (final stop in stops) _stopCard(stop),
        ]),
      ),
      bottomNavigationBar: _nextStep(trip),
    );
  }

  Widget _stopCard(Map stop) {
    final kids = (stop['students'] as List).cast<Map>();
    final arrived = stop['arrivedAt'] != null;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 10, 6, 10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            CircleAvatar(radius: 13, backgroundColor: arrived ? Colors.green : ink, child: Text('${stop['sequence']}', style: const TextStyle(color: Colors.white, fontSize: 12))),
            const SizedBox(width: 10),
            Expanded(child: Text('${stop['name']}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15))),
            Text('${stop['scheduledTime']}', style: const TextStyle(color: Colors.grey)),
            if (_running && !arrived)
              IconButton(
                tooltip: 'Mark this stop reached',
                icon: const Icon(Icons.flag_outlined),
                onPressed: _busy ? null : () => _act(() => Api.instance.post('$_base/stops/${stop['routeStopId']}/arrive')),
              )
            else
              const SizedBox(width: 12),
          ]),
          if (kids.isEmpty) const Padding(padding: EdgeInsets.only(top: 6, left: 36), child: Text('No children today', style: TextStyle(color: Colors.grey))),
          for (final k in kids)
            Padding(
              padding: const EdgeInsets.only(top: 8, left: 36),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('${k['name']}', style: const TextStyle(fontSize: 16)),
                    if (k['specialInstructions'] != null)
                      Text('${k['specialInstructions']}', style: const TextStyle(fontSize: 12, color: Colors.deepOrange))
                    else if (k['status'] != 'SCHEDULED')
                      Text(statusLabel[k['status']] ?? '${k['status']}', style: TextStyle(fontSize: 12, color: statusColor(k['status'] as String))),
                  ]),
                ),
                _studentActions(k),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.title, this.subtitle, this.warn = false});
  final String title;
  final String? subtitle;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: warn ? const Color(0xFFFDECEC) : const Color(0xFFE8F0FD), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Row(children: [
            Icon(warn ? Icons.gps_off : Icons.circle, size: 10, color: warn ? Colors.red : Colors.green),
            const SizedBox(width: 6),
            Expanded(child: Text(subtitle!, style: const TextStyle(fontSize: 13))),
          ]),
        ],
      ]),
    );
  }
}
