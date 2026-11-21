import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';

import 'api.dart';
import 'crew.dart';
import 'login.dart';
import 'parent.dart';
import 'widgets.dart';

export 'widgets.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(statusBarColor: Colors.transparent));
  runApp(const SchoolBusApp());
}

class SchoolBusApp extends StatelessWidget {
  const SchoolBusApp({super.key});

  @override
  Widget build(BuildContext context) {
    final scheme = ColorScheme.fromSeed(seedColor: blue, primary: blue, secondary: brand, surface: Colors.white);
    return MaterialApp(
      title: 'School Bus',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: scheme,
        useMaterial3: true,
        scaffoldBackgroundColor: const Color(0xFFF3F5F8),
        appBarTheme: const AppBarTheme(backgroundColor: navy, foregroundColor: Colors.white, elevation: 0, centerTitle: false),
        filledButtonTheme: FilledButtonThemeData(
          style: FilledButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)), textStyle: const TextStyle(fontWeight: FontWeight.w700)),
        ),
        outlinedButtonTheme: OutlinedButtonThemeData(
          style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFFF3F5F8),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        ),
        snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
      ),
      home: const StartScreen(),
    );
  }
}

/// Animated splash, then the right home screen for whoever is logged in.
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
    final results = await Future.wait([Api.instance.restore(), Future<void>.delayed(const Duration(milliseconds: 1300))]);
    if (!mounted) return;
    final session = results.first as Session?;
    Navigator.of(context).pushReplacement(PageRouteBuilder(
      transitionDuration: const Duration(milliseconds: 500),
      pageBuilder: (_, __, ___) => homeFor(session),
      transitionsBuilder: (_, a, __, child) => FadeTransition(opacity: a, child: child),
    ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: headerGradient),
        child: Center(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            ClipRRect(borderRadius: BorderRadius.circular(28), child: Image.asset('assets/icon.png', width: 112, height: 112))
                .animate()
                .scale(begin: const Offset(0.5, 0.5), end: const Offset(1, 1), duration: 600.ms, curve: Curves.elasticOut)
                .then()
                .shimmer(duration: 900.ms, color: Colors.white24),
            const SizedBox(height: 18),
            const Text('School Bus', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800))
                .animate()
                .fadeIn(delay: 300.ms)
                .slideY(begin: 0.4, end: 0),
            const SizedBox(height: 6),
            Text('Safe rides, every day', style: TextStyle(color: Colors.white.withValues(alpha: 0.7)))
                .animate()
                .fadeIn(delay: 500.ms),
          ]),
        ),
      ),
    );
  }
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
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text), backgroundColor: green));
}
