import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import 'api.dart';
import 'main.dart';

const consentVersion = '2026-11';

/// Parent home: a card per child with a clear status, live tracking and fee.
class ParentHome extends StatefulWidget {
  const ParentHome({super.key});

  @override
  State<ParentHome> createState() => _ParentHomeState();
}

class _ParentHomeState extends State<ParentHome> {
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
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 24, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('Add your child', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text('Enter the 8-letter code from the transport office.', style: TextStyle(color: Colors.grey.shade600)),
          const SizedBox(height: 16),
          TextField(
            controller: code,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 22, letterSpacing: 6, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(hintText: 'ABCD2345'),
          ),
          const SizedBox(height: 16),
          FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), onPressed: () => Navigator.pop(ctx, true), child: const Text('Add child')),
        ]),
      ),
    );
    if (ok != true) return;
    try {
      final res = await Api.instance.post('/parent/children/link', {'activationCode': code.text.trim()});
      if (mounted) showInfo(context, '${res['name']} added');
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final name = Api.instance.session?.name.split(' ').first ?? '';
    return Scaffold(
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: EdgeInsets.zero, children: [
          GradientHeader(
            title: '${greeting()}, $name',
            subtitle: _kids.isEmpty ? 'Welcome to School Bus' : 'Here’s how your ${_kids.length == 1 ? 'child is' : 'children are'} doing',
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                icon: const Icon(Icons.notifications_none, color: Colors.white),
                tooltip: 'Alerts',
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AlertsScreen())),
              ),
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_vert, color: Colors.white),
                onSelected: (v) {
                  if (v == 'add') _link();
                  if (v == 'sos') _sos(context);
                  if (v == 'logout') logoutAndRestart(context);
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'add', child: ListTile(leading: Icon(Icons.person_add_alt), title: Text('Add a child'))),
                  PopupMenuItem(value: 'sos', child: ListTile(leading: Icon(Icons.sos, color: Colors.red), title: Text('Emergency (SOS)'))),
                  PopupMenuItem(value: 'logout', child: ListTile(leading: Icon(Icons.logout), title: Text('Log out'))),
                ],
              ),
            ]),
          ),
          Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 24), child: _body()),
        ]),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()));
    }
    if (!_consent) {
      return _Panel(children: [
        const Icon(Icons.privacy_tip_outlined, size: 44, color: blue),
        const SizedBox(height: 12),
        const Text('Your child’s privacy', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 10),
        const Text(
          'To keep your child safe, the transport company stores your child’s name, school, class, photo, pickup point and trip '
          'records, and shows you the bus location only while your child’s trip is running. You can ask to see, correct or delete '
          'this information at any time by contacting the transport office.',
        ),
        const SizedBox(height: 18),
        FilledButton(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), onPressed: _giveConsent, child: const Text('I agree')),
      ]).enter(0);
    }
    if (_kids.isEmpty) {
      return _Panel(children: [
        const Text('🧒', style: TextStyle(fontSize: 56)).animate(onPlay: (c) => c.repeat(reverse: true)).moveY(begin: -4, end: 4, duration: 1200.ms),
        const SizedBox(height: 10),
        const Text('Add your child', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text('Ask the transport office for your child’s 8-letter code.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey.shade600)),
        const SizedBox(height: 18),
        FilledButton.icon(style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)), onPressed: _link, icon: const Icon(Icons.add), label: const Text('Add with a code')),
      ]).enter(0);
    }
    return Column(children: [
      for (var i = 0; i < _kids.length; i++)
        _ChildCard(child: _kids[i], trips: _today[_kids[i]['studentId']] ?? const [], onChanged: _load).enter(i),
    ]);
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
      child: Column(children: children),
    );
  }
}

Future<void> _sos(BuildContext context) async {
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.sos, color: Colors.red, size: 40),
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

/// Plain-language status for a child's trip, with an emoji.
(String, String) childStatus(String status, String direction, String name) {
  final morning = direction == 'MORNING';
  switch (status) {
    case 'SCHEDULED':
      return morning ? ('🚌', 'Bus is on the way to pick up $name') : ('🏫', '$name is waiting for the bus at school');
    case 'BOARDED':
      return morning ? ('🚌', '$name is on the bus to school') : ('🚌', '$name is on the bus home');
    case 'AT_SCHOOL':
      return ('🏫', '$name reached school safely');
    case 'HANDED_OVER':
    case 'DROPPED_ALONE':
      return ('🏠', '$name was dropped home safely');
    case 'ABSENT':
      return ('📅', 'Marked absent — no pickup');
    case 'NO_SHOW':
      return ('⚠️', morning ? '$name was not at the stop' : '$name did not come to the bus');
    case 'HELD':
      return ('🛑', '$name is safe on the bus. Please call the office');
    case 'RETURNED':
      return ('🛑', '$name is being taken back to school');
    default:
      return ('ℹ️', statusLabel[status] ?? status);
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
    final fee = child['fee'] as Map?;
    final running = trips.cast<Map>().where((t) => t['canTrack'] == true).toList();
    final latest = running.isNotEmpty ? running.first : (trips.isNotEmpty ? trips.cast<Map>().last : null);
    final pending = child['status'] == 'PENDING_APPROVAL';
    final (emoji, text) = pending
        ? ('⏳', 'Waiting for the transport office to approve')
        : latest != null
            ? childStatus(latest['studentStatus'] as String, latest['direction'] as String, name)
            : ('😴', 'No bus trip right now');
    final Color color = pending ? amber : (latest != null ? statusColor(latest['studentStatus'] as String) : Colors.grey.shade600);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 6))],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 18, 18, 0),
          child: Row(children: [
            CircleAvatar(
              radius: 26,
              backgroundColor: brand,
              child: Text(name.substring(0, 1), style: const TextStyle(fontSize: 22, color: ink, fontWeight: FontWeight.w800)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(child['name'] as String, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                Text('${child['school']}${child['className'] != null ? ' · Class ${child['className']}' : ''}', style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
              ]),
            ),
            if (running.isNotEmpty) const LiveBadge(),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 0),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 400),
            child: Container(
              key: ValueKey(text),
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: color.withValues(alpha: 0.09), borderRadius: BorderRadius.circular(16)),
              child: Row(children: [
                Text(emoji, style: const TextStyle(fontSize: 26)),
                const SizedBox(width: 12),
                Expanded(child: Text(text, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 15.5))),
              ]),
            ),
          ),
        ),
        if (running.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 0),
            child: FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(54), backgroundColor: blue),
              icon: const Icon(Icons.map_rounded),
              label: const Text('Watch the bus live', style: TextStyle(fontSize: 16.5)),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => TrackScreen(tripId: running.first['tripId'] as String))),
            ).animate(onPlay: (c) => c.repeat()).shimmer(delay: 1500.ms, duration: 1200.ms, color: Colors.white30),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 4),
          child: Wrap(spacing: 8, runSpacing: 8, children: [
            if (morning != null) _Info(icon: Icons.wb_sunny_outlined, text: 'Pickup ${morning['time']}'),
            if (afternoon != null) _Info(icon: Icons.home_outlined, text: 'Drop ${afternoon['time']}'),
            if (morning != null && morning['busNumber'] != null) _Info(icon: Icons.directions_bus_outlined, text: '${morning['busNumber']}'),
            if (fee != null) _FeeChip(fee: fee),
          ]),
        ),
        if (!pending)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
              child: TextButton.icon(icon: const Icon(Icons.event_busy, size: 18), label: const Text('Won’t need the bus'), onPressed: () => _absent(context)),
            ),
          ),
      ]),
    );
  }

  Future<void> _absent(BuildContext context) async {
    final now = DateTime.now();
    final choice = await showModalBottomSheet<String>(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(18), child: Text('When won’t your child need the bus?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
          ListTile(leading: const Text('📅', style: TextStyle(fontSize: 22)), title: const Text('Today (whole day)'), onTap: () => Navigator.pop(ctx, 'today')),
          ListTile(leading: const Text('🌇', style: TextStyle(fontSize: 22)), title: const Text('Today, afternoon only'), onTap: () => Navigator.pop(ctx, 'today-pm')),
          ListTile(leading: const Text('🗓️', style: TextStyle(fontSize: 22)), title: const Text('Tomorrow (whole day)'), onTap: () => Navigator.pop(ctx, 'tomorrow')),
          ListTile(leading: const Text('📆', style: TextStyle(fontSize: 22)), title: const Text('Choose a date…'), onTap: () => Navigator.pop(ctx, 'pick')),
          const SizedBox(height: 8),
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

class _Info extends StatelessWidget {
  const _Info({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: const Color(0xFFF3F5F8), borderRadius: BorderRadius.circular(12)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 16, color: Colors.grey.shade700),
        const SizedBox(width: 5),
        Text(text, style: TextStyle(fontSize: 13, color: Colors.grey.shade800, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class _FeeChip extends StatelessWidget {
  const _FeeChip({required this.fee});
  final Map fee;

  @override
  Widget build(BuildContext context) {
    final status = fee['status'] as String;
    final c = statusColor(status);
    final due = (fee['dueRupees'] as num).round();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(status == 'PAID' ? Icons.check_circle : Icons.currency_rupee, size: 16, color: c),
        const SizedBox(width: 4),
        Text(status == 'PAID' ? 'Fee paid' : '₹$due fee ${status == 'OVERDUE' ? 'overdue' : 'due'}', style: TextStyle(fontSize: 13, color: c, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}

/// Alerts list.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
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

  IconData _icon(String type) {
    if (type.contains('BOARDED')) return Icons.directions_bus;
    if (type.contains('SCHOOL')) return Icons.school;
    if (type.contains('HANDED') || type.contains('DROPPED')) return Icons.home;
    if (type.contains('APPROACH') || type.contains('ARRIVED')) return Icons.near_me;
    if (type.contains('HELD') || type.contains('NO_SHOW') || type.contains('RETURNED')) return Icons.warning_amber;
    return Icons.notifications;
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Alerts')),
      body: items == null
          ? const Center(child: CircularProgressIndicator())
          : items.isEmpty
              ? Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Text('🔔', style: TextStyle(fontSize: 48)),
                    const SizedBox(height: 8),
                    Text('No alerts yet', style: TextStyle(color: Colors.grey.shade600)),
                  ]),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: items.length,
                    itemBuilder: (_, i) {
                      final n = items[i] as Map;
                      final at = DateTime.parse(n['createdAt'] as String).toLocal();
                      final type = n['type'] as String;
                      final warn = type.contains('HELD') || type.contains('NO_SHOW');
                      return Container(
                        margin: const EdgeInsets.only(bottom: 10),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: (warn ? red : blue).withValues(alpha: 0.1),
                            child: Icon(_icon(type), color: warn ? red : blue),
                          ),
                          title: Text(n['title'] as String, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${n['body']}\n${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')} · ${at.day}/${at.month}'),
                          isThreeLine: true,
                        ),
                      ).enter(i < 8 ? i : 8);
                    },
                  ),
                ),
    );
  }
}

/// Live map of the bus: satellite view, road route, smooth bus movement and ETA.
class TrackScreen extends StatefulWidget {
  const TrackScreen({super.key, required this.tripId});
  final String tripId;

  @override
  State<TrackScreen> createState() => _TrackScreenState();
}

class _TrackScreenState extends State<TrackScreen> with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _live;
  String? _error;
  Timer? _timer;
  final _map = MapController();
  bool _centred = false;
  bool _satellite = true;
  late final AnimationController _move = AnimationController(vsync: this, duration: const Duration(milliseconds: 4500));
  LatLng? _from;
  LatLng? _to;

  LatLng? get _busNow {
    final to = _to;
    final from = _from;
    if (to == null) return null;
    if (from == null) return to;
    final t = Curves.easeInOut.transform(_move.value);
    return LatLng(from.latitude + (to.latitude - from.latitude) * t, from.longitude + (to.longitude - from.longitude) * t);
  }

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 5), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _move.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final live = await Api.instance.get('/parent/trips/${widget.tripId}/live') as Map<String, dynamic>;
      if (!mounted) return;
      final bus = live['bus'] as Map?;
      if (bus != null) {
        final next = LatLng((bus['lat'] as num).toDouble(), (bus['lng'] as num).toDouble());
        if (_to == null || next != _to) {
          _from = _busNow ?? next;
          _to = next;
          _move.forward(from: 0);
        }
        if (!_centred) {
          _centred = true;
          _map.move(next, 15);
        }
      }
      setState(() {
        _live = live;
        _error = null;
      });
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
    final school = live?['school'] as Map?;
    final kids = (live?['children'] as List? ?? []).cast<Map>();
    LatLng p(Map m) => LatLng((m['lat'] as num).toDouble(), (m['lng'] as num).toDouble());
    final stops = route.map(p).toList();
    final road = pathFrom(live?['path'], stops);
    final start = _to ?? (stops.isNotEmpty ? stops.first : const LatLng(30.90, 75.85));
    final myStops = kids.map((k) => (k['stop'] as Map?)?['routeStopId']).toSet();

    return Scaffold(
      body: Stack(children: [
        FlutterMap(
          mapController: _map,
          options: MapOptions(initialCenter: start, initialZoom: 14),
          children: [
            ...mapTiles(satellite: _satellite),
            ...roadLine(road),
            MarkerLayer(markers: [
              for (final s in route)
                Marker(
                  point: p(s),
                  width: myStops.contains(s['routeStopId']) ? 44 : 22,
                  height: myStops.contains(s['routeStopId']) ? 44 : 22,
                  child: myStops.contains(s['routeStopId'])
                      ? const Icon(Icons.location_on, color: Colors.deepOrange, size: 44)
                      : Container(
                          decoration: BoxDecoration(
                            color: s['reached'] == true ? green : ink,
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 3),
                          ),
                        ),
                ),
              if (school != null && school['lat'] != null)
                Marker(
                  point: p(school),
                  width: 40,
                  height: 40,
                  child: Container(
                    decoration: BoxDecoration(color: blue, shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3)),
                    child: const Center(child: Text('🏫', style: TextStyle(fontSize: 18))),
                  ),
                ),
            ]),
            AnimatedBuilder(
              animation: _move,
              builder: (_, __) {
                final now = _busNow;
                return MarkerLayer(markers: [
                  if (now != null) Marker(point: now, width: 56, height: 56, child: const BusMarker()),
                ]);
              },
            ),
            MapAttribution(satellite: _satellite),
          ],
        ),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(children: [
              Material(
                color: Colors.white,
                shape: const CircleBorder(),
                elevation: 4,
                child: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => Navigator.pop(context)),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 8)],
                  ),
                  child: Row(children: [
                    Expanded(
                      child: Text(live?['direction'] == 'AFTERNOON' ? 'Bus coming home' : 'Bus to school', style: const TextStyle(fontWeight: FontWeight.w800)),
                    ),
                    if (live != null && live['signalLost'] != true) const LiveBadge(),
                  ]),
                ),
              ),
              const SizedBox(width: 10),
              MapStyleButton(satellite: _satellite, onTap: () => setState(() => _satellite = !_satellite)),
            ]),
          ),
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: live == null
              ? (_error != null ? _ErrorCard(text: _error!) : const SizedBox())
              : _InfoSheet(live: live, kids: kids, route: route, error: _error, onFindBus: _to == null ? null : () => _map.move(_to!, 16)),
        ),
      ]),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
        child: Text(text),
      );
}

class _InfoSheet extends StatelessWidget {
  const _InfoSheet({required this.live, required this.kids, required this.route, this.error, this.onFindBus});
  final Map<String, dynamic> live;
  final List<Map> kids;
  final List<Map> route;
  final String? error;
  final VoidCallback? onFindBus;

  @override
  Widget build(BuildContext context) {
    final bus = live['bus'] as Map?;
    final lost = live['signalLost'] == true;
    final kid = kids.isNotEmpty ? kids.first : null;
    final eta = kid?['etaSeconds'] as num?;
    final dist = kid?['distanceM'] as num?;
    final reachedStop = kid?['busReachedStop'] == true;
    final mins = eta == null ? null : (eta / 60).ceil();
    final reachedCount = route.where((r) => r['reached'] == true).length;
    final stopName = (kid?['stop'] as Map?)?['name'] ?? 'your stop';

    Widget headline;
    if (reachedStop) {
      headline = const Text('Bus is at your stop 🎉', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: green));
    } else if (mins == null) {
      headline = const Text('Bus has passed your stop', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800));
    } else {
      headline = Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: mins.toDouble()),
            duration: const Duration(milliseconds: 800),
            builder: (_, v, __) => Text('${v.round()}', style: const TextStyle(fontSize: 44, fontWeight: FontWeight.w900, height: 1)),
          ),
          const Padding(padding: EdgeInsets.only(bottom: 6, left: 4), child: Text('min away', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
        ]),
        Text('${((dist ?? 0) / 1000).toStringAsFixed(1)} km to $stopName', style: TextStyle(color: Colors.grey.shade600)),
      ]);
    }

    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        boxShadow: [BoxShadow(color: Colors.black26, blurRadius: 16)],
      ),
      padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
      child: SafeArea(
        top: false,
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(4)))),
          const SizedBox(height: 14),
          if (error != null) Padding(padding: const EdgeInsets.only(bottom: 10), child: Text(error!, style: const TextStyle(color: red))),
          if (lost)
            Container(
              padding: const EdgeInsets.all(10),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(color: const Color(0xFFFFF4D6), borderRadius: BorderRadius.circular(12)),
              child: Row(children: [
                const Icon(Icons.gps_off, color: amber),
                const SizedBox(width: 8),
                Expanded(child: Text(bus == null ? 'Waiting for the bus location…' : 'GPS signal lost. Showing the last known position.')),
              ]),
            ),
          Row(children: [
            Expanded(child: headline),
            if (kid != null) StatusChip(kid['status'] as String),
          ]),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: route.isEmpty ? 0 : reachedCount / route.length),
              duration: const Duration(milliseconds: 900),
              builder: (_, v, __) => LinearProgressIndicator(value: v, minHeight: 8, backgroundColor: const Color(0xFFEDEFF3), color: green),
            ),
          ),
          const SizedBox(height: 4),
          Row(children: [
            Text('$reachedCount of ${route.length} stops done', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            const Spacer(),
            if (bus != null) Text('${(bus['speedKmh'] as num? ?? 0).round()} km/h', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            if (onFindBus != null) TextButton.icon(onPressed: onFindBus, icon: const Icon(Icons.my_location, size: 18), label: const Text('Find bus')),
          ]),
        ]),
      ),
    ).animate().slideY(begin: 0.3, end: 0, duration: 400.ms, curve: Curves.easeOutCubic);
  }
}
