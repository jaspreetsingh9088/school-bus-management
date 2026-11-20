import 'package:flutter/material.dart';

import 'api.dart';
import 'crew.dart';
import 'login.dart';
import 'parent.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const SchoolBusApp());
}

const brand = Color(0xFFF2A900);
const ink = Color(0xFF17202A);

class SchoolBusApp extends StatelessWidget {
  const SchoolBusApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'School Bus',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: brand, primary: const Color(0xFF1F6FEB)),
        useMaterial3: true,
        appBarTheme: const AppBarTheme(backgroundColor: brand, foregroundColor: ink),
      ),
      home: const StartScreen(),
    );
  }
}

/// Opens the right home screen for whoever is logged in.
class StartScreen extends StatefulWidget {
  const StartScreen({super.key});

  @override
  State<StartScreen> createState() => _StartScreenState();
}

class _StartScreenState extends State<StartScreen> {
  @override
  void initState() {
    super.initState();
    _go();
  }

  Future<void> _go() async {
    final session = await Api.instance.restore();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => homeFor(session)));
  }

  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}

Widget homeFor(Session? session) {
  if (session == null) return const LoginScreen();
  if (session.role == 'PARENT') return const ParentHome();
  if (session.role == 'DRIVER' || session.role == 'ATTENDANT') return const CrewHome();
  return const LoginScreen(message: 'This app is for parents, drivers and attendants. Office staff use the web panel.');
}

Future<void> logoutAndRestart(BuildContext context) async {
  await Api.instance.logout();
  if (!context.mounted) return;
  Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
}

void showError(BuildContext context, Object e) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: Colors.red.shade700));
}

void showInfo(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

Color statusColor(String status) {
  switch (status) {
    case 'BOARDED':
    case 'IN_PROGRESS':
      return const Color(0xFF1F5FBF);
    case 'AT_SCHOOL':
    case 'HANDED_OVER':
    case 'DROPPED_ALONE':
    case 'COMPLETED':
      return const Color(0xFF1A7F37);
    case 'NO_SHOW':
    case 'PENDING_APPROVAL':
      return const Color(0xFF9A6700);
    case 'HELD':
    case 'RETURNED':
      return const Color(0xFFC62828);
    default:
      return Colors.grey.shade600;
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(statusLabel[status] ?? status, style: TextStyle(color: c, fontWeight: FontWeight.w600, fontSize: 12)),
    );
  }
}
