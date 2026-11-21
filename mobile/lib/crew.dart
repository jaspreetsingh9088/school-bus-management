import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

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
    final trips = _trips;
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: EdgeInsets.zero, children: [
          GradientHeader(
            title: '${greeting()}, ${s.name.split(' ').first}',
            subtitle: '${s.role == 'DRIVER' ? 'Driver' : 'Attendant'} · ${s.companyName}',
            trailing: IconButton(icon: const Icon(Icons.logout, color: Colors.white), tooltip: 'Log out', onPressed: () => logoutAndRestart(context)),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
            child: trips == null
                ? const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
                : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Today’s trips', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 10),
                    if (trips.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(28),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                        child: Column(children: [
                          const Text('☕', style: TextStyle(fontSize: 48)),
                          const SizedBox(height: 8),
                          Text('No trips for you today. Pull down to refresh.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600)),
                        ]),
                      ).enter(0),
                    for (var i = 0; i < trips.length; i++) _tripCard(trips[i] as Map).enter(i),
                  ]),
          ),
        ]),
      ),
    );
  }

  Widget _tripCard(Map row) {
    final trip = row['trip'] as Map;
    final morning = trip['direction'] == 'MORNING';
    final status = trip['status'] as String;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 14, offset: const Offset(0, 6))],
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(24),
        onTap: () async {
          await Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(tripId: trip['id'] as String)));
          _load();
        },
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: morning ? [const Color(0xFFFFC400), const Color(0xFFFF8A00)] : [const Color(0xFF5B8DEF), const Color(0xFF1F3A8A)]),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Center(child: Text(morning ? '🌅' : '🌇', style: const TextStyle(fontSize: 28))),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(morning ? 'Morning pickup' : 'Afternoon drop-off', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
                const SizedBox(height: 2),
                Text('${row['routeName']} · ${row['busNumber']}', style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
              ]),
            ),
            status == 'IN_PROGRESS' ? const LiveBadge(label: 'RUNNING') : StatusChip(status),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, color: Colors.grey),
          ]),
        ),
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
    HapticFeedback.mediumImpact();
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
        actions: [
          IconButton(
            icon: const Icon(Icons.map_outlined),
            tooltip: 'Route map',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TripMapScreen(sheet: sheet, myPosition: _last))),
          ),
          IconButton(icon: const Icon(Icons.sos, color: Colors.redAccent), tooltip: 'Report a problem', onPressed: _incident),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(12, 12, 12, 24), children: [
          _Banner(
            done: kids.where((k) => !['SCHEDULED', 'BOARDED', 'HELD'].contains(k['status'])).length,
            total: kids.length,
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
          for (var i = 0; i < stops.length; i++) _stopCard(stops[i]).enter(i < 6 ? i : 6),
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
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                  child: KeyedSubtree(key: ValueKey('${k['studentId']}-${k['status']}'), child: _studentActions(k)),
                ),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.title, this.subtitle, this.warn = false, this.done = 0, this.total = 0});
  final String title;
  final String? subtitle;
  final bool warn;
  final int done;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: warn ? const LinearGradient(colors: [Color(0xFFC62828), Color(0xFF8E1B1B)]) : headerGradient,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Colors.white)),
        if (subtitle != null) ...[
          const SizedBox(height: 4),
          Row(children: [
            Icon(warn ? Icons.gps_off : Icons.circle, size: 10, color: warn ? Colors.white : Colors.greenAccent)
                .animate(onPlay: (c) => c.repeat(reverse: true))
                .fade(begin: 0.4, end: 1, duration: 800.ms),
            const SizedBox(width: 6),
            Expanded(child: Text(subtitle!, style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.85)))),
          ]),
        ],
        if (total > 0) ...[
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: done / total),
              duration: const Duration(milliseconds: 700),
              builder: (_, v, __) => LinearProgressIndicator(value: v, minHeight: 8, color: brand, backgroundColor: Colors.white24),
            ),
          ),
          const SizedBox(height: 4),
          Text('$done of $total children done', style: TextStyle(fontSize: 12, color: Colors.white.withValues(alpha: 0.8))),
        ],
      ]),
    );
  }
}

/// Route map for the crew: road, stops, the bus's own position, and a button to navigate.
class TripMapScreen extends StatefulWidget {
  const TripMapScreen({super.key, required this.sheet, this.myPosition});
  final Map<String, dynamic> sheet;
  final Position? myPosition;

  @override
  State<TripMapScreen> createState() => _TripMapScreenState();
}

class _TripMapScreenState extends State<TripMapScreen> {
  bool _satellite = true;

  @override
  Widget build(BuildContext context) {
    final stops = (widget.sheet['stops'] as List).cast<Map>();
    final school = widget.sheet['school'] as Map?;
    LatLng p(Map m) => LatLng((m['lat'] as num).toDouble(), (m['lng'] as num).toDouble());
    final stopPts = stops.map(p).toList();
    final road = pathFrom(widget.sheet['path'], stopPts);
    final me = widget.myPosition == null ? null : LatLng(widget.myPosition!.latitude, widget.myPosition!.longitude);
    final next = stops.cast<Map?>().firstWhere((s) => s!['arrivedAt'] == null, orElse: () => null);
    final all = [...stopPts, if (me != null) me, if (school != null && school['lat'] != null) p(school)];

    return Scaffold(
      appBar: AppBar(title: const Text('Route map')),
      body: Stack(children: [
        FlutterMap(
          options: MapOptions(
            initialCameraFit: all.length > 1 ? CameraFit.coordinates(coordinates: all, padding: const EdgeInsets.all(48)) : null,
            initialCenter: all.isNotEmpty ? all.first : const LatLng(30.90, 75.85),
            initialZoom: 14,
          ),
          children: [
            ...mapTiles(satellite: _satellite),
            ...roadLine(road),
            MarkerLayer(markers: [
              for (final s in stops)
                Marker(
                  point: p(s),
                  width: 30,
                  height: 30,
                  child: Container(
                    decoration: BoxDecoration(color: s['arrivedAt'] != null ? green : ink, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)),
                    child: Center(child: Text('${s['sequence']}', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800))),
                  ),
                ),
              if (school != null && school['lat'] != null)
                Marker(point: p(school), width: 36, height: 36, child: const Text('🏫', style: TextStyle(fontSize: 28))),
              if (me != null) Marker(point: me, width: 56, height: 56, child: const BusMarker()),
            ]),
            MapAttribution(satellite: _satellite),
          ],
        ),
        Positioned(right: 14, top: 14, child: MapStyleButton(satellite: _satellite, onTap: () => setState(() => _satellite = !_satellite))),
        if (next != null)
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(56), backgroundColor: blue),
              icon: const Icon(Icons.navigation),
              label: Text('Navigate to ${next['name']}', overflow: TextOverflow.ellipsis),
              onPressed: () => launchUrl(
                Uri.parse('https://www.google.com/maps/dir/?api=1&destination=${next['lat']},${next['lng']}&travelmode=driving'),
                mode: LaunchMode.externalApplication,
              ),
            ).animate().slideY(begin: 1, end: 0, duration: 400.ms, curve: Curves.easeOutBack),
          ),
      ]),
    );
  }
}
