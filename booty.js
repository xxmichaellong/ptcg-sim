case 'prizes':
    switch (mLocation){
        case 'bench':
            moveCard(prizes, prizes, bench, bench_html);
            break;
        case 'discard':
            moveCard(prizes, prizes, discard, discard_html);
            break;
        case 'prizes':
            moveCard(prizes, prizes, prizes, prizes_html);
            break;
        case 'lostzone':
            moveCard(prizes, prizes, lostzone, lostzone_html);
            break;
        case 'active':
            moveCard(prizes, prizes, active, active_html);
            break;
        case 'stadium':
            moveCard(prizes, prizes, stadium, stadium_html);
            break;
        case 'deck':
            moveCard(prizes, prizes, deck, deck_html);
            break;
        case 'hand':
            moveCard(prizes, prizes, hand, hand_html);
            break;
    };