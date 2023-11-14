import { moveCard } from "./move-card.js";

export function moveEventTarget(selectedCard, mLocation, targetImage){
    switch (selectedCard.location){
        case hand:
            switch (mLocation){
                case bench:
                    moveCard(_hand, _hand_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_hand, _hand_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_hand, _hand_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_hand, _hand_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_hand, _hand_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_hand, _hand_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_hand, _hand_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_hand, _hand_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case bench:
            switch (mLocation){
                case bench:
                    moveCard(_bench, _bench_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_bench, _bench_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_bench, _bench_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_bench, _bench_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_bench, _bench_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_bench, _bench_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_bench, _bench_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_bench, _bench_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case discard:
            switch (mLocation){
                case bench:
                    moveCard(_discard, _discard_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_discard, _discard_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_discard, _discard_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_discard, _discard_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_discard, _discard_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_discard, _discard_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_discard, _discard_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_discard, _discard_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case prizes:
            switch (mLocation){
                case bench:
                    moveCard(_prizes, _prizes_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_prizes, _prizes_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_prizes, _prizes_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_prizes, _prizes_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_prizes, _prizes_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_prizes, _prizes_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_prizes, _prizes_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_prizes, _prizes_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case lostzone:
            switch (mLocation){
                case bench:
                    moveCard(_lostzone, _lostzone_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_lostzone, _lostzone_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_lostzone, _lostzone_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_lostzone, _lostzone_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_lostzone, _lostzone_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_lostzone, _lostzone_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_lostzone, _lostzone_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_lostzone, _lostzone_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case active:
            switch (mLocation){
                case bench:
                    moveCard(_active, _active_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_active, _active_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_active, _active_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_active, _active_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_active, _active_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_active, _active_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_active, _active_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_active, _active_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case stadium:
            switch (mLocation){
                case bench:
                    moveCard(_stadium, _stadium_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_stadium, _stadium_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_stadium, _stadium_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_stadium, _stadium_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_stadium, _stadium_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_stadium, _stadium_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_stadium, _stadium_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_stadium, _stadium_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case deck:
            switch (mLocation){
                case bench:
                    moveCard(_deck, _deck_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_deck, _deck_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_deck, _deck_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_deck, _deck_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_deck, _deck_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_deck, _deck_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_deck, _deck_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_deck, _deck_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case hand:
            switch (mLocation){
                case bench:
                    moveCard(_hand, _hand_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(_hand, _hand_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(_hand, _hand_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(_hand, _hand_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(_hand, _hand_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(_hand, _hand_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(_hand, _hand_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(_hand, _hand_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case flowerSelectingZone:
            switch (mLocation){
                case bench:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(flowerSelectingZone, flowerSelectingZone_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
        case colresssExperimentZone:
            switch (mLocation){
                case bench:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _bench, _bench_html, selectedCard.index, targetImage);
                    break;
                case discard:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _discard, _discard_html, selectedCard.index, targetImage);
                    break;
                case prizes:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _prizes, _prizes_html, selectedCard.index, targetImage);
                    break;
                case lostzone:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _lostzone, _lostzone_html, selectedCard.index, targetImage);
                    break;
                case active:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _active, _active_html, selectedCard.index, targetImage);
                    break;
                case stadium:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _stadium, _stadium_html, selectedCard.index, targetImage);
                    break;
                case deck:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _deck, _deck_html, selectedCard.index, targetImage);
                    break;
                case hand:
                    moveCard(colresssExperimentZone, colresssExperimentZone_html, _hand, _hand_html, selectedCard.index, targetImage);
                    break;
            };
            break;
    };
}