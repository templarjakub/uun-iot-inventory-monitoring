"""Simulated HX711 + Load Cell weighing channel with stability & quality evaluation."""

from __future__ import annotations

import random
import statistics
from dataclasses import dataclass

from common.models import MeasurementQuality


@dataclass
class WeighingChannelConfig:
    """Configuration of a single weighing channel (e.g. UZ-001/V1)."""

    source_id: str
    tare_weight_g: float = 100.0
    unit_weight_g: float = 6.0
    initial_pieces: int = 30
    noise_std_g: float = 0.25
    stability_threshold_g: float = 1.5
    max_capacity_g: float = 5000.0
    sample_count: int = 5
    unstable_probability: float = 0.0
    fault_probability: float = 0.0


@dataclass(frozen=True)
class LoadCellReading:
    """Processed output of one multi-sample HX711 weighing cycle."""

    source_id: str
    measured_weight_g: float
    quality: MeasurementQuality
    sample_count: int
    sample_spread_g: float


class WeighingChannelSimulator:
    """Simulates multi-sample HX711 load-cell acquisition and stability filtering."""

    def __init__(self, config: WeighingChannelConfig, seed: int | None = None) -> None:
        self.config = config
        self._rng = random.Random(seed)
        self._pieces = max(0, int(config.initial_pieces))
        self._force_unstable = False
        self._force_fault = False

    @property
    def source_id(self) -> str:
        return self.config.source_id

    @property
    def piece_count(self) -> int:
        return self._pieces

    @property
    def expected_gross_weight_g(self) -> float:
        return round(self.config.tare_weight_g + self._pieces * self.config.unit_weight_g, 2)

    def set_pieces(self, pieces: int) -> None:
        self._pieces = max(0, int(pieces))

    def adjust_pieces(self, delta: int) -> int:
        self._pieces = max(0, self._pieces + int(delta))
        return self._pieces

    def trigger_unstable_once(self) -> None:
        """Force the next reading to exhibit hand/vibration disturbance (unstable)."""
        self._force_unstable = True

    def trigger_fault_once(self) -> None:
        """Force the next reading to exhibit an HX711 sensor fault (invalid)."""
        self._force_fault = True

    def read(self) -> LoadCellReading:
        """Acquire N raw samples, evaluate stability, and classify measurementQuality."""
        cfg = self.config

        # Check for simulated sensor fault (e.g. disconnected load cell / out-of-range)
        is_fault = self._force_fault or (
            cfg.fault_probability > 0 and self._rng.random() < cfg.fault_probability
        )
        self._force_fault = False
        if is_fault:
            return LoadCellReading(
                source_id=cfg.source_id,
                measured_weight_g=-99.9,
                quality="invalid",
                sample_count=cfg.sample_count,
                sample_spread_g=0.0,
            )

        # Check for simulated mechanical disturbance (operator touching container)
        is_unstable = self._force_unstable or (
            cfg.unstable_probability > 0 and self._rng.random() < cfg.unstable_probability
        )
        self._force_unstable = False

        base_weight = self.expected_gross_weight_g
        if is_unstable:
            samples = [
                base_weight + self._rng.uniform(-12.0, 18.0)
                for _ in range(cfg.sample_count)
            ]
        else:
            samples = [
                base_weight + self._rng.gauss(0.0, cfg.noise_std_g)
                for _ in range(cfg.sample_count)
            ]

        spread = max(samples) - min(samples)
        median_weight = round(statistics.median(samples), 2)

        quality: MeasurementQuality
        if median_weight < -5.0 or median_weight > cfg.max_capacity_g:
            quality = "invalid"
        elif spread > cfg.stability_threshold_g:
            quality = "unstable"
        else:
            quality = "validAndStable"

        return LoadCellReading(
            source_id=cfg.source_id,
            measured_weight_g=median_weight,
            quality=quality,
            sample_count=cfg.sample_count,
            sample_spread_g=round(spread, 3),
        )
